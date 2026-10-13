import * as core from '@actions/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from '../src/index';
import * as gumroad from '../src/gumroad';

jest.mock('@actions/core');
jest.mock('../src/gumroad');

describe('Action run() Entrypoint', () => {
  const tmpDir = path.join(__dirname, 'tmp');
  const testFile = path.join(tmpDir, 'test-package.zip');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    fs.writeFileSync(testFile, 'dummy zip content for unit testing');
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      switch (name) {
        case 'access-token':
          return 'gumroad_secret_token';
        case 'product-id':
          return 'prod_123';
        case 'file-path':
          return testFile;
        case 'file-name':
          return 'custom-package.zip';
        default:
          return '';
      }
    });

    const summaryMock = {
      addHeading: jest.fn().mockReturnThis(),
      addList: jest.fn().mockReturnThis(),
      addRaw: jest.fn().mockReturnThis(),
      write: jest.fn().mockResolvedValue(undefined)
    };
    (core as unknown as { summary: typeof summaryMock }).summary = summaryMock;
  });

  it('runs the full upload lifecycle successfully with custom file-name', async () => {
    (gumroad.presignFile as jest.Mock).mockResolvedValue({
      success: true,
      upload_id: 'up_abc',
      key: 'key_123',
      file_url: 'https://gumroad.com/files/custom-package.zip',
      parts: [{ part_number: 1, presigned_url: 'https://s3.test/upload' }]
    });

    (gumroad.uploadPart as jest.Mock).mockResolvedValue({
      part_number: 1,
      etag: 'etag_1'
    });

    (gumroad.completeUpload as jest.Mock).mockResolvedValue({
      success: true,
      file_url: 'https://gumroad.com/files/custom-package.zip'
    });

    (gumroad.attachFileToProduct as jest.Mock).mockResolvedValue({
      success: true,
      product: { id: 'prod_123', name: 'Product Name' }
    });

    await run();

    expect(gumroad.presignFile).toHaveBeenCalledWith({
      accessToken: 'gumroad_secret_token',
      fileName: 'custom-package.zip',
      fileSize: expect.any(Number)
    });

    expect(gumroad.uploadPart).toHaveBeenCalledWith({
      presignedUrl: 'https://s3.test/upload',
      partNumber: 1,
      buffer: expect.any(Buffer)
    });

    expect(gumroad.completeUpload).toHaveBeenCalledWith({
      accessToken: 'gumroad_secret_token',
      uploadId: 'up_abc',
      key: 'key_123',
      parts: [{ part_number: 1, etag: 'etag_1' }]
    });

    expect(gumroad.attachFileToProduct).toHaveBeenCalledWith({
      accessToken: 'gumroad_secret_token',
      productId: 'prod_123',
      fileUrl: 'https://gumroad.com/files/custom-package.zip'
    });

    expect(core.setOutput).toHaveBeenCalledWith('file-url', 'https://gumroad.com/files/custom-package.zip');
    expect(core.setOutput).toHaveBeenCalledWith('upload-id', 'up_abc');
    expect(core.summary.write).toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('defaults to basename when custom file-name is omitted and falls back to presign file_url', async () => {
    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      switch (name) {
        case 'access-token':
          return 'gumroad_secret_token';
        case 'product-id':
          return 'prod_123';
        case 'file-path':
          return testFile;
        case 'file-name':
          return '';
        default:
          return '';
      }
    });

    (gumroad.presignFile as jest.Mock).mockResolvedValue({
      success: true,
      upload_id: 'up_abc',
      key: 'key_123',
      file_url: 'https://gumroad.com/files/test-package.zip',
      parts: [{ part_number: 1, presigned_url: 'https://s3.test/upload' }]
    });

    (gumroad.uploadPart as jest.Mock).mockResolvedValue({
      part_number: 1,
      etag: 'etag_1'
    });

    (gumroad.completeUpload as jest.Mock).mockResolvedValue({
      success: true,
      file_url: ''
    });

    (gumroad.attachFileToProduct as jest.Mock).mockResolvedValue({
      success: true,
      product: { id: 'prod_123' }
    });

    await run();

    expect(gumroad.presignFile).toHaveBeenCalledWith({
      accessToken: 'gumroad_secret_token',
      fileName: 'test-package.zip',
      fileSize: expect.any(Number)
    });

    expect(core.setOutput).toHaveBeenCalledWith('file-url', 'https://gumroad.com/files/test-package.zip');
  });

  it('fails cleanly when specified file-path does not exist', async () => {
    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      if (name === 'file-path') return path.join(tmpDir, 'nonexistent.zip');
      return 'test';
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Specified file-path does not exist')
    );
    expect(gumroad.presignFile).not.toHaveBeenCalled();
  });

  it('fails cleanly when specified file-path is a directory', async () => {
    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      if (name === 'file-path') return tmpDir;
      return 'test';
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Specified file-path is not a file')
    );
  });

  it('fails cleanly when non-Error object is thrown', async () => {
    (gumroad.presignFile as jest.Mock).mockRejectedValue('Raw string rejection error');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('Raw string rejection error');
    expect(core.summary.write).toHaveBeenCalled();
  });

  it('handles summary write failure gracefully when an error occurs', async () => {
    const brokenSummary = {
      addHeading: jest.fn().mockReturnThis(),
      addList: jest.fn().mockReturnThis(),
      addRaw: jest.fn().mockReturnThis(),
      write: jest.fn().mockRejectedValue(new Error('Summary buffer error'))
    };
    (core as unknown as { summary: typeof brokenSummary }).summary = brokenSummary;

    (gumroad.presignFile as jest.Mock).mockRejectedValue(new Error('Presign failed'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('Presign failed');
  });

  it('fails cleanly when presign response has empty parts array', async () => {
    (gumroad.presignFile as jest.Mock).mockResolvedValue({
      success: true,
      upload_id: 'up_abc',
      key: 'key_123',
      file_url: 'https://gumroad.com/files/test.zip',
      parts: []
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      'Gumroad presign response did not return a valid upload ID or upload parts.'
    );
  });

  it('fails cleanly when presign response has missing upload_id', async () => {
    (gumroad.presignFile as jest.Mock).mockResolvedValue({
      success: true,
      upload_id: '',
      key: 'key_123',
      file_url: 'https://gumroad.com/files/test.zip',
      parts: [{ part_number: 1, presigned_url: 'https://s3.test' }]
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      'Gumroad presign response did not return a valid upload ID or upload parts.'
    );
  });
});
