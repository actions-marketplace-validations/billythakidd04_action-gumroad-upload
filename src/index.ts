import * as core from '@actions/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  presignFile,
  uploadPart,
  completeUpload,
  attachFileToProduct,
  UploadPart
} from './gumroad';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export async function run(): Promise<void> {
  let fileName = '';
  let productId = '';

  try {
    const accessToken = core.getInput('access-token', { required: true });
    productId = core.getInput('product-id', { required: true });
    const filePath = core.getInput('file-path', { required: true });
    const customFileName = core.getInput('file-name');

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Specified file-path does not exist: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Specified file-path is not a file: ${resolvedPath}`);
    }

    const fileSize = stats.size;
    fileName = customFileName || path.basename(resolvedPath);

    core.info(`Preparing Gumroad upload for file: ${fileName} (${formatBytes(fileSize)})`);
    core.info(`Target Product ID: ${productId}`);

    // Step 1: Request presigned upload credentials
    core.info('Requesting presigned upload credentials from Gumroad...');
    const presign = await presignFile({
      accessToken,
      fileName,
      fileSize
    });

    if (!presign || !presign.upload_id || !Array.isArray(presign.parts) || presign.parts.length === 0) {
      throw new Error('Gumroad presign response did not return a valid upload ID or upload parts.');
    }

    core.info(`Presign successful. Upload ID: ${presign.upload_id}, Parts: ${presign.parts.length}`);

    // Step 2: Upload parts
    const completedParts: UploadPart[] = [];
    const fileDescriptor = fs.openSync(resolvedPath, 'r');

    try {
      // Gumroad parts typically divide file into chunks (default 100MB per part)
      const partSize = Math.ceil(fileSize / presign.parts.length);

      for (let i = 0; i < presign.parts.length; i++) {
        const partInfo = presign.parts[i];
        const offset = i * partSize;
        const currentChunkSize = Math.min(partSize, fileSize - offset);

        core.info(`Uploading part ${partInfo.part_number}/${presign.parts.length} (${formatBytes(currentChunkSize)})...`);
        const buffer = Buffer.alloc(currentChunkSize);
        fs.readSync(fileDescriptor, buffer, 0, currentChunkSize, offset);

        const uploadedPart = await uploadPart({
          presignedUrl: partInfo.presigned_url,
          partNumber: partInfo.part_number,
          buffer
        });

        completedParts.push(uploadedPart);
      }
    } finally {
      fs.closeSync(fileDescriptor);
    }

    // Step 3: Complete upload
    core.info('Finalizing file upload with Gumroad...');
    const complete = await completeUpload({
      accessToken,
      uploadId: presign.upload_id,
      key: presign.key,
      parts: completedParts
    });

    const fileUrl = complete.file_url || presign.file_url;
    core.info(`Upload completed. Canonical URL: ${fileUrl}`);

    // Step 4: Attach file to product
    core.info(`Attaching uploaded file to Gumroad product ${productId}...`);
    await attachFileToProduct({
      accessToken,
      productId,
      fileUrl
    });

    // Step 5: Set outputs & step summary
    core.setOutput('file-url', fileUrl);
    core.setOutput('upload-id', presign.upload_id);

    core.summary
      .addHeading('🛒 Gumroad Upload: Successful', 3)
      .addList([
        `**Product ID**: \`${productId}\``,
        `**File**: \`${fileName}\` (${formatBytes(fileSize)})`,
        `**Upload ID**: \`${presign.upload_id}\``,
        `**Canonical URL**: \`${fileUrl}\``
      ]);
    await core.summary.write();

    core.info(`Successfully uploaded and attached ${fileName} to Gumroad product ${productId}!`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);

    try {
      core.summary
        .addHeading('❌ Gumroad Upload: Failed', 3)
        .addRaw(`> ${message}\n\n`)
        .addList([
          `**Product ID**: \`${productId || 'N/A'}\``,
          `**File**: \`${fileName || 'N/A'}\``
        ]);
      await core.summary.write();
    } catch {
      // Ignore summary write errors if summary buffer is unavailable
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  void run();
}
