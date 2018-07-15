#!/bin/sh

# armokweb: Copyright (C) 2018+ Morgan Jones
#
# armokweb is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# armokweb is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with armokweb.  If not, see <https://www.gnu.org/licenses/>.

[ -f /etc/profile ] && source /etc/profile

DIR="$(dirname -- "$0")"

trap exit SIGHUP

DELAY=5

while [ 1 ]; do
    echo "Starting desktop environment..."
    "$DIR/runner.sh"

    echo "Everything exited. Waiting $DELAY seconds to restart."
    sleep $DELAY
done
