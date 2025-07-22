#!/bin/bash
# Deploy cloud-processor to Google Cloud Run

echo "Deploying cloud-processor to Google Cloud Run..."

cd cloud-processor

# Build and get the image name
echo "Building Docker image..."
IMAGE_TAG="us-central1-docker.pkg.dev/rhythm-cut-466519/cloud-run-source-deploy/rhythm-cut-processor-v2:$(date +%s)"

gcloud builds submit \
  --tag $IMAGE_TAG \
  --region=us-central1 \
  --timeout=20m

# Deploy the built image
echo "Deploying to Cloud Run..."
gcloud run deploy rhythm-cut-processor-v2 \
  --image=$IMAGE_TAG \
  --region=us-central1 \
  --allow-unauthenticated \
  --memory=2Gi \
  --cpu=2 \
  --timeout=540 \
  --max-instances=100 \
  --project=rhythm-cut-466519

echo "Deployment complete!"
echo "Service URL: https://rhythm-cut-processor-v2-859380352423.us-central1.run.app"