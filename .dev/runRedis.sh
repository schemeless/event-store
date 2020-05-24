#!/usr/bin/env bash

if [ ! "$(docker ps -q -f name=redis)" ]; then
    if [ "$(docker ps -aq -f status=exited -f name=redis)" ]; then
        # cleanup
        docker rm redis
    fi
    # run redis
    docker run --name redis -p 6379:6379 -d redis:5.0.7-alpine
fi
