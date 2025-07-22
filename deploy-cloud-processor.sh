#!/bin/bash
# Deploy cloud-processor to Google Cloud Run

echo "Deploying cloud-processor to Google Cloud Run..."

cd cloud-processor

gcloud run deploy rhythm-cut-processor \
  --source . \
  --region=us-central1 \
  --allow-unauthenticated \
  --memory=2Gi \
  --cpu=2 \
  --timeout=540 \
  --max-instances=100 \
  --project=rhythm-cut-466519

echo "Deployment complete!"
echo "Service URL: https://rhythm-cut-processor-859380352423.us-central1.run.app"