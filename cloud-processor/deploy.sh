#!/bin/bash

# Google Cloud project configuration
PROJECT_ID="rhythm-cut-466519"
SERVICE_NAME="rhythm-cut-processor"
REGION="us-central1"

echo "🚀 Deploying Rhythm Cut Processor to Google Cloud Run"

# Build and deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --source . \
  --project $PROJECT_ID \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --set-env-vars "INPUT_BUCKET=rhythm-cut-inputs-466519,OUTPUT_BUCKET=rhythm-cut-outputs-466519,TEMP_BUCKET=rhythm-cut-temp-466519"

echo "✅ Deployment complete!"