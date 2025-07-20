# Rhythm Cut Cloud Processor

## Deployment Instructions

### Option 1: Deploy using gcloud CLI (Recommended)

1. Install Google Cloud SDK if not already installed:
   ```bash
   # macOS
   brew install google-cloud-sdk
   
   # Or download from https://cloud.google.com/sdk/docs/install
   ```

2. Authenticate with Google Cloud:
   ```bash
   gcloud auth login
   gcloud config set project rhythm-cut-466519
   ```

3. Deploy to Cloud Run:
   ```bash
   cd cloud-processor
   ./deploy.sh
   ```

### Option 2: Deploy using Google Cloud Console

1. Go to https://console.cloud.google.com/run
2. Click "CREATE SERVICE"
3. Choose "Continuously deploy from a repository"
4. Or choose "Deploy one revision from an existing container image"

### Option 3: Build and Deploy with Docker

1. Build the container locally:
   ```bash
   docker build -t gcr.io/rhythm-cut-466519/rhythm-cut-processor .
   ```

2. Push to Google Container Registry:
   ```bash
   docker push gcr.io/rhythm-cut-466519/rhythm-cut-processor
   ```

3. Deploy to Cloud Run:
   ```bash
   gcloud run deploy rhythm-cut-processor \
     --image gcr.io/rhythm-cut-466519/rhythm-cut-processor \
     --region us-central1 \
     --platform managed \
     --allow-unauthenticated
   ```

## Testing the Service

Once deployed, test the health endpoint:
```bash
curl https://rhythm-cut-processor-859380352423.us-central1.run.app/
```

Expected response:
```json
{
  "status": "healthy",
  "service": "rhythm-cut-processor",
  "version": "1.0.0"
}
```