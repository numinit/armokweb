#!/bin/sh

DIR="$(dirname "$0")"

trap exit SIGHUP

LOG="$DIR/dwarves.log"
DELAY=5

while [ 1 ]; do
    echo "Starting desktop environment..."
    "$DIR/dwarves.sh" | tee "$LOG"

    echo "Everything exited. Waiting $DELAY seconds to restart."
    sleep $DELAY
done
