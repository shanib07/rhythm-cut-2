# Rhythm Cut - Google Cloud Deployment Guide

## Current Status

✅ Google Cloud infrastructure setup complete
✅ Railway environment variables configured  
✅ Google Cloud processing code created
✅ Cloud Run service deployed (rhythm-cut-processor)
✅ Manual deployment process established

## Deployment Architecture

This project uses a hybrid deployment:
- **Railway**: Hosts the main Next.js application (UI, API, basic processing)
- **Google Cloud Run**: Hosts the dedicated video processing microservice

## Deployment Instructions

### Railway Deployment (Main App)

Railway automatically deploys from the main branch using Nixpacks:
1. Push to main branch
2. Railway automatically builds and deploys
3. Configuration is in `railway.json`

### Google Cloud Run Deployment (Video Processor)

**Important**: Do NOT use Cloud Build triggers for cloud-processor due to directory structure conflicts.

Deploy manually using:

1. **Go to Cloud Run**: https://console.cloud.google.com/run?project=rhythm-cut-466519

2. **Create Service**:
   - Click "CREATE SERVICE"
   - Choose "Continuously deploy from a repository"
   - Connect to your GitHub repository
   - Set source directory: `cloud-processor/`
   - Build type: Dockerfile

3. **Configure Service**:
   - Service name: `rhythm-cut-processor`
   - Region: `us-central1`
   - CPU allocation: 2 vCPU
   - Memory: 2 GiB
   - Maximum instances: 10
   - Allow unauthenticated invocations: ✅

4. **Environment Variables**:
   ```
   INPUT_BUCKET=rhythm-cut-inputs-466519
   OUTPUT_BUCKET=rhythm-cut-outputs-466519
   TEMP_BUCKET=rhythm-cut-temp-466519
   ```

5. **Deploy and Test**:
   - Deploy the service
   - Test health endpoint: `https://your-service-url/`
   - Should return: `{"status":"healthy","service":"rhythm-cut-processor","version":"1.0.0"}`

### 2. Update Railway Environment (Already Done)

Railway environment variables are already configured:
- ✅ `GOOGLE_CLOUD_CREDENTIALS` (JSON service account key)
- ✅ `GOOGLE_CLOUD_PROJECT_ID=rhythm-cut-466519`
- ✅ `GOOGLE_CLOUD_INPUT_BUCKET=rhythm-cut-inputs-466519`
- ✅ `GOOGLE_CLOUD_OUTPUT_BUCKET=rhythm-cut-outputs-466519`
- ✅ `GOOGLE_CLOUD_RUN_URL=https://rhythm-cut-processor-859380352423.us-central1.run.app`

### 3. Test Complete Pipeline

After Cloud Run deployment:

1. **Upload Test**: Try uploading videos through Railway
2. **Processing Test**: Verify videos are uploaded to Cloud Storage
3. **Cloud Run Test**: Check processing logs in Cloud Run
4. **Download Test**: Verify processed videos download successfully
5. **Speed Test**: Compare processing times vs Railway-only

## Architecture Overview

```
User (Railway Frontend)
    ↓ Upload videos
Google Cloud Storage (Input Bucket)
    ↓ Process request
Google Cloud Run (Video Processing)
    ↓ Upload result
Google Cloud Storage (Output Bucket)
    ↓ Signed URL
User (Download processed video)
```

## Expected Performance Improvements

- **Upload Speed**: Google Cloud's global network vs Railway limitations
- **Processing Speed**: Dedicated 2vCPU + 2GB RAM vs Railway shared resources
- **Download Speed**: Google Cloud CDN vs Railway bandwidth limits
- **Scalability**: Auto-scaling Cloud Run vs single Railway instance

## Monitoring

- **Cloud Run Logs**: https://console.cloud.google.com/run/detail/us-central1/rhythm-cut-processor/logs
- **Cloud Storage Usage**: https://console.cloud.google.com/storage/browser
- **Railway Logs**: Railway dashboard for frontend monitoring

## Cost Estimation

- **Cloud Run**: ~$0.10-0.50 per video (depending on length)
- **Cloud Storage**: ~$0.02 per GB stored
- **Railway**: Keep current plan for frontend hosting
- **Total Savings**: Reduced Railway compute usage