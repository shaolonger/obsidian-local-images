import { URL } from "url";
import path from "path";

import { App, DataAdapter } from "obsidian";

import {
  isUrl,
  downloadImage,
  fileExtByContent,
  cleanFileName,
  pathJoin,
} from "./utils";
import {
  FILENAME_TEMPLATE,
  MAX_FILENAME_INDEX,
  FILENAME_ATTEMPTS,
} from "./config";
import { linkHashes } from "./linksHash";

export function imageTagProcessor(
  app: App,
  mediaDir: string,
  mdStrReplaceFolder: string
) {
  async function processImageTag(match: string, anchor: string, link: string) {
    if (!isUrl(link)) {
      return match;
    }

    try {
      const fileData = await downloadImage(link);

      // when several images refer to the same file they can be partly
      // failed to download because file already exists, so try to resuggest filename several times
      let attempt = 0;
      while (attempt < FILENAME_ATTEMPTS) {
        try {
          const { fileName, needWrite, mdReplaceFileName } =
            await chooseFileName(
              app.vault.adapter,
              mediaDir,
              mdStrReplaceFolder,
              anchor,
              link,
              fileData
            );

          if (needWrite && fileName) {
            await app.vault.createBinary(fileName, fileData);
          }

          if (fileName) {
            return `![${anchor}](${mdReplaceFileName})`;
          } else {
            return match;
          }
        } catch (error) {
          if (error.message === "File already exists.") {
            attempt++;
          } else {
            throw error;
          }
        }
      }
      return match;
    } catch (error) {
      console.warn("Image processing failed: ", error);
      return match;
    }
  }

  return processImageTag;
}

async function chooseFileName(
  adapter: DataAdapter,
  dir: string,
  mdDir: string,
  baseName: string,
  link: string,
  contentData: ArrayBuffer
): Promise<{
  fileName: string;
  needWrite: boolean;
  mdReplaceFileName: string;
}> {
  const fileExt = await fileExtByContent(contentData);
  if (!fileExt) {
    return { fileName: "", needWrite: false, mdReplaceFileName: "" };
  }
  // if there is no anchor try get file name from url
  if (!baseName) {
    const parsedUrl = new URL(link);

    baseName = path.basename(parsedUrl.pathname);
  }
  // if there is no part for file name from url use name template
  if (!baseName) {
    baseName = FILENAME_TEMPLATE;
  }

  // if filename already ends with correct extension, remove it to work with base name
  if (baseName.endsWith(`.${fileExt}`)) {
    baseName = baseName.slice(0, -1 * (fileExt.length + 1));
  }

  baseName = cleanFileName(baseName);

  let fileName = "";
  let mdReplaceFileName = "";
  let needWrite = true;
  let index = 0;
  while (!fileName && index < MAX_FILENAME_INDEX) {
    const suggestedName = index
      ? pathJoin(dir, `${baseName}-${index}.${fileExt}`)
      : pathJoin(dir, `${baseName}.${fileExt}`);
    const mdName = index
      ? pathJoin(mdDir, `${baseName}-${index}.${fileExt}`)
      : pathJoin(mdDir, `${baseName}.${fileExt}`);

    if (await adapter.exists(suggestedName, false)) {
      linkHashes.ensureHashGenerated(link, contentData);

      const fileData = await adapter.readBinary(suggestedName);

      if (linkHashes.isSame(link, fileData)) {
        fileName = suggestedName;
        needWrite = false;
        mdReplaceFileName = mdName;
      }
    } else {
      fileName = suggestedName;
      mdReplaceFileName = mdName;
    }

    index++;
  }
  if (!fileName) {
    throw new Error("Failed to generate file name for media file.");
  }

  linkHashes.ensureHashGenerated(link, contentData);

  return { fileName, mdReplaceFileName, needWrite };
}
