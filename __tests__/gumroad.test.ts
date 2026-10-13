import {
  presignFile,
  uploadPart,
  completeUpload,
  attachFileToProduct
} from '../src/gumroad';
import { formatBytes } from '../src/index';

describe('formatBytes', () => {
  it('formats 0 bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats KB, MB, and GB accurately', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(5242880)).toBe('5 MB');
    expect(formatBytes(1073741824)).toBe('1 GB');
  });
});

describe('Gumroad API Client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('presignFile', () => {
    it('returns presign payload on successful API response with default apiBase', async () => {
      const mockResponse = {
        success: true,
        upload_id: 'up_123',
        key: 'keys/archive.zip',
        file_url: 'https://gumroad.com/files/archive.zip',
        parts: [
          { part_number: 1, presigned_url: 'https://s3.amazonaws.com/presigned-part-1' }
        ]
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as Response);

      const result = await presignFile({
        accessToken: 'test_token',
        fileName: 'archive.zip',
        fileSize: 1048576
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.gumroad.com/v2/files/presign',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('throws error when HTTP status is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized access token'
      } as Response);

      await expect(
        presignFile({
          accessToken: 'bad_token',
          fileName: 'archive.zip',
          fileSize: 100,
          apiBase: 'https://api.test'
        })
      ).rejects.toThrow('Gumroad presign request failed (HTTP 401): Unauthorized access token');
    });

    it('throws error when response JSON has success=false with message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
          message: 'Invalid file size'
        })
      } as Response);

      await expect(
        presignFile({
          accessToken: 'tok',
          fileName: 'bad.zip',
          fileSize: 0,
          apiBase: 'https://api.test'
        })
      ).rejects.toThrow('Gumroad presign failed: Invalid file size');
    });

    it('throws error when response JSON has success=false with default message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: false
        })
      } as Response);

      await expect(
        presignFile({
          accessToken: 'tok',
          fileName: 'bad.zip',
          fileSize: 0,
          apiBase: 'https://api.test'
        })
      ).rejects.toThrow('Gumroad presign failed: Unknown error');
    });
  });

  describe('uploadPart', () => {
    it('uploads chunk and extracts lowercase etag from headers', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'etag' ? '"etag-abc-123"' : null)
        }
      } as unknown as Response);

      const result = await uploadPart({
        presignedUrl: 'https://s3.test/part-1',
        partNumber: 1,
        buffer: Buffer.from('test binary chunk')
      });

      expect(result).toEqual({
        part_number: 1,
        etag: 'etag-abc-123'
      });
    });

    it('uploads chunk and extracts uppercase ETag from headers', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'ETag' ? '"ETAG-UPPERCASE"' : null)
        }
      } as unknown as Response);

      const result = await uploadPart({
        presignedUrl: 'https://s3.test/part-1',
        partNumber: 2,
        buffer: Buffer.from('test binary chunk 2')
      });

      expect(result).toEqual({
        part_number: 2,
        etag: 'ETAG-UPPERCASE'
      });
    });

    it('falls back to partNumber string if etag header is missing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => null
        }
      } as unknown as Response);

      const result = await uploadPart({
        presignedUrl: 'https://s3.test/part-3',
        partNumber: 3,
        buffer: Buffer.from('test chunk without etag')
      });

      expect(result).toEqual({
        part_number: 3,
        etag: '3'
      });
    });

    it('throws error when upload chunk fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'S3 upload error'
      } as Response);

      await expect(
        uploadPart({
          presignedUrl: 'https://s3.test/part-1',
          partNumber: 1,
          buffer: Buffer.from('test')
        })
      ).rejects.toThrow('Gumroad chunk upload failed for part 1 (HTTP 500): S3 upload error');
    });
  });

  describe('completeUpload', () => {
    it('sends complete payload and returns canonical file url with default apiBase', async () => {
      const mockResponse = {
        success: true,
        file_url: 'https://gumroad.com/files/completed.zip'
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as Response);

      const result = await completeUpload({
        accessToken: 'tok_123',
        uploadId: 'up_999',
        key: 'keys/my-file.zip',
        parts: [{ part_number: 1, etag: 'etag123' }]
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.gumroad.com/v2/files/complete',
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('throws error when complete request fails with HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Missing parts'
      } as Response);

      await expect(
        completeUpload({
          accessToken: 'tok',
          uploadId: 'up',
          key: 'k',
          parts: [],
          apiBase: 'https://api.test'
        })
      ).rejects.toThrow('Gumroad complete request failed (HTTP 400): Missing parts');
    });

    it('throws error when complete request returns success=false without message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: false
        })
      } as Response);

      await expect(
        completeUpload({
          accessToken: 'tok',
          uploadId: 'up',
          key: 'k',
          parts: [{ part_number: 1, etag: '1' }],
          apiBase: 'https://api.test'
        })
      ).rejects.toThrow('Gumroad complete failed: Unknown error');
    });
  });

  describe('attachFileToProduct', () => {
    it('attaches file URL to product successfully with default apiBase', async () => {
      const mockResponse = {
        success: true,
        product: {
          id: 'prod_abc',
          name: 'My Digital Product'
        }
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as Response);

      const result = await attachFileToProduct({
        accessToken: 'tok_abc',
        productId: 'prod_abc',
        fileUrl: 'https://gumroad.com/files/completed.zip'
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.gumroad.com/v2/products/prod_abc',
        expect.objectContaining({
          method: 'PUT'
        })
      );
    });

    it('throws error when product attach fails with HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Product not found'
      } as Response);

      await expect(
        attachFileToProduct({
          accessToken: 'tok',
          productId: 'nonexistent',
          fileUrl: 'https://url',
          apiBase: 'https://api.test'
        })
      ).rejects.toThrow('Gumroad product attach failed (HTTP 404): Product not found');
    });

    it('throws error when product attach returns success=false without message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: false
        })
      } as Response);

      await expect(
        attachFileToProduct({
          accessToken: 'tok',
          productId: 'prod_1',
          fileUrl: 'https://url',
          apiBase: 'https://api.test'
        })
      ).rejects.toThrow('Gumroad product attach failed: Unknown error');
    });
  });
});
