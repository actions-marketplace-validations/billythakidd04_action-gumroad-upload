export interface PresignResponse {
  success: boolean;
  upload_id: string;
  key: string;
  file_url: string;
  parts: Array<{
    part_number: number;
    presigned_url: string;
  }>;
  message?: string;
}

export interface CompleteResponse {
  success: boolean;
  file_url: string;
  message?: string;
}

export interface ProductResponse {
  success: boolean;
  product?: {
    id: string;
    name: string;
    [key: string]: unknown;
  };
  message?: string;
}

export interface UploadPart {
  part_number: number;
  etag: string;
}

const GUMROAD_API_BASE = 'https://api.gumroad.com/v2';

export async function presignFile(options: {
  accessToken: string;
  fileName: string;
  fileSize: number;
  apiBase?: string;
}): Promise<PresignResponse> {
  const { accessToken, fileName, fileSize, apiBase = GUMROAD_API_BASE } = options;
  const endpoint = `${apiBase}/files/presign`;

  const params = new URLSearchParams({
    access_token: accessToken,
    filename: fileName,
    file_size: fileSize.toString()
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gumroad presign request failed (HTTP ${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as PresignResponse;
  if (!data.success) {
    throw new Error(`Gumroad presign failed: ${data.message || 'Unknown error'}`);
  }

  return data;
}

export async function uploadPart(options: {
  presignedUrl: string;
  partNumber: number;
  buffer: Buffer | Uint8Array;
}): Promise<UploadPart> {
  const { presignedUrl, partNumber, buffer } = options;

  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: buffer
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gumroad chunk upload failed for part ${partNumber} (HTTP ${response.status}): ${errorBody}`);
  }

  const etag = response.headers.get('etag') || response.headers.get('ETag') || `"${partNumber}"`;
  return {
    part_number: partNumber,
    etag: etag.replace(/^"+|"+$/g, '')
  };
}

export async function completeUpload(options: {
  accessToken: string;
  uploadId: string;
  key: string;
  parts: UploadPart[];
  apiBase?: string;
}): Promise<CompleteResponse> {
  const { accessToken, uploadId, key, parts, apiBase = GUMROAD_API_BASE } = options;
  const endpoint = `${apiBase}/files/complete`;

  const params = new URLSearchParams();
  params.append('access_token', accessToken);
  params.append('upload_id', uploadId);
  params.append('key', key);

  for (const part of parts) {
    params.append('parts[][part_number]', part.part_number.toString());
    params.append('parts[][etag]', `"${part.etag}"`);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gumroad complete request failed (HTTP ${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as CompleteResponse;
  if (!data.success) {
    throw new Error(`Gumroad complete failed: ${data.message || 'Unknown error'}`);
  }

  return data;
}

export async function attachFileToProduct(options: {
  accessToken: string;
  productId: string;
  fileUrl: string;
  apiBase?: string;
}): Promise<ProductResponse> {
  const { accessToken, productId, fileUrl, apiBase = GUMROAD_API_BASE } = options;
  const endpoint = `${apiBase}/products/${encodeURIComponent(productId)}`;

  const params = new URLSearchParams();
  params.append('access_token', accessToken);
  params.append('files[][url]', fileUrl);

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gumroad product attach failed (HTTP ${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as ProductResponse;
  if (!data.success) {
    throw new Error(`Gumroad product attach failed: ${data.message || 'Unknown error'}`);
  }

  return data;
}
