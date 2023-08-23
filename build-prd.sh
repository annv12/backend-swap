#!/usr/bin/env bash

set -e

# define variables
PROJECT_ID=${PROJECT_ID:-novaland}
APP_NAME=backend-swap-api
REPOSITORY_NAME=asia-southeast1-docker.pkg.dev/novaland-337909/novaland-registry/${APP_NAME}
GCLOUD_ACCOUNT=${GCLOUD_ACCOUNT:-netlambda@gmail.com}
GCLOUD_ZONE=${GCLOUD_ZONE:-asia-southeast1-a}
ENV=${ENV:-prd}

# define func
gcloud_setup () {
    gcloud config set account ${GCLOUD_ACCOUNT}
    gcloud config set compute/zone ${GCLOUD_ZONE}
    gcloud config set project ${PROJECT_ID}
}

push_image () {
    DOCKER_IMAGE_NAME=${1}
    docker push ${DOCKER_IMAGE_NAME}
    if [ $? -ne 0 ]; then
        echo "if you have not set up docker config, you need to authenticate docker by the following command."
        echo "gcloud auth configure-docker"
    fi
}

# set gcloud settings
# gcloud_setup

# go to current directory
cd `dirname $0`

# build Docker image
today=`date +%Y%m%d-%H%M%S`
current_tag_seq=`date +%Y%m%d`
next_tag_seq=$(expr $current_tag_seq + 1)
tag="${today}"
if [ $next_tag_seq -gt 1 ] ; then
    tag="${tag}-${next_tag_seq}"
fi
echo "tag is ${tag}"
case "${ENV}" in
  "prd" | "production" ) BUILD_ENV=prd ;;
  "stg" | "staging" ) BUILD_ENV=stg ;;
  * ) BUILD_ENV=dev ;;
esac
DOCKER_IMAGE_NAME=${REPOSITORY_NAME}:${tag}
echo "build image ${DOCKER_IMAGE_NAME}"
docker build -t ${DOCKER_IMAGE_NAME} --build-arg BUILD_ENV=${BUILD_ENV} .

# push docker image
# read -p "Push docker image? (y/N): " yn
# case "$yn" in
#     [yY]*) push_image ${DOCKER_IMAGE_NAME} ;;
#     *) echo "skip." ;;
# esac

push_image ${DOCKER_IMAGE_NAME}

echo -n "${tag}" > version

sed -ri '' "s/backend-swap-api:.*$/backend-swap-api:${tag}/g" k8s/prd/api/backend-dp.yml
kubectl apply -f k8s/prd/api/backend-dp.yml
