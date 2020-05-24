#!/usr/bin/env bash

docker run --name mysql-service -e MYSQL_ROOT_PASSWORD=M0cFd80FAFOjIajY0_c -e MYSQL_DATABASE=service -p 3307:3306 -d mysql:5.7
docker run --name mysql-event-store -e MYSQL_ROOT_PASSWORD=M0cFd80FAFOjIajY0_c -e MYSQL_DATABASE=event-store -p 3308:3306 -d mysql:5.7

