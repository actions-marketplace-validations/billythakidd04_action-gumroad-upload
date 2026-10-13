# Gumroad File Upload GitHub Action

A standalone GitHub Action to upload digital product release archives and attach them to Gumroad products using Gumroad's multipart presigned upload API.

## Features

- **Automated Multipart Upload**: Manages presigning, binary chunk uploads to S3, and finalizing uploads via Gumroad's API.
- **Product Attachment**: Automatically links the uploaded release archive to your target Gumroad product.
- **Job Step Summaries**: Generates immediate formatted summaries in `$GITHUB_STEP_SUMMARY`.
- **Zero Runtime Dependencies**: Packaged with `@vercel/ncc` into a single standalone bundle.

## Usage

```yaml
- name: Upload Release Archive to Gumroad
  uses: billythakidd04/action-gumroad-upload@v1
  with:
    access-token: ${{ secrets.GUMROAD_ACCESS_TOKEN }}
    product-id: ${{ secrets.GUMROAD_PRODUCT_ID }}
    file-path: 'dist/my-package-v1.0.0.zip'
    file-name: 'my-package-v1.0.0.zip' # Optional override
```

## Inputs

| Input | Description | Required | Default |
|---|---|---|---|
| `access-token` | Gumroad API Access Token | Yes | |
| `product-id` | Gumroad Product ID or Permalink | Yes | |
| `file-path` | Path to the release archive or file on disk | Yes | |
| `file-name` | Custom display file name on Gumroad | No | Basename of `file-path` |

## Outputs

| Output | Description |
|---|---|
| `file-url` | Canonical URL of the uploaded file on Gumroad |
| `upload-id` | Gumroad internal upload identifier |

## Local Development

```bash
# Install dependencies
npm ci

# Run test suite
npm test

# Build bundled action distribution
npm run build
```

## License

MIT
