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

DIR="$(dirname -- "$0")"

export LP_NUM_THREADS=2

if command -v dfhack &> /dev/null; then
    "$DIR/wrap.sh" --terminal "DFHack Console" --exec "dfhack" &
else
    "$DIR/wrap.sh" --terminal "DF Console" --exec "dwarf-fortress" &
fi

# Wait a second so Therapist doesn't warn the user that the process doesn't exist
sleep 1

"$DIR/wrap.sh" --terminal "Therapist Console" --exec "DwarfTherapist" &
wait
exit 0
