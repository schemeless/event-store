#!/usr/bin/env bash

docker run --name postgres-event-store-test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=event_store_test \
  -p 5432:5432 \
  -d postgres:15-alpine
