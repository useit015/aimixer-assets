#!/bin/bash

rsync -a --exclude "node_modules" . root@assets.aimixer.io:/home/aimixer-assets/
