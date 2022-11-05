#!/bin/sh

set -ex

tag=$(git tag --points-at HEAD)

if [ -z "$tag" ]; then
  tag='latest'
fi

docker buildx create --name mybuilder --use || echo 'skip'
docker buildx inspect --bootstrap

path=$(dirname $DOCKERFILE)
ext=${path##*/}
image="ghcr.io/$GITHUB_REPOSITORY/$ext"

docker buildx build \
  --cache-from "type=local,src=$RUNNER_TEMP/docker-cache" \
  --cache-to "type=local,dest=$RUNNER_TEMP/docker-cache-new" \
  --push \
  --platform $PLATFORM \
  -t $image:$tag \
  -f $DOCKERFILE .
docker buildx imagetools inspect $image:$tag
