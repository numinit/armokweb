#!/bin/sh

# armokweb: Copyright (C) 2018+ Morgan Jones
#
# armokweb is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# armokweb is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with armokweb.  If not, see <https://www.gnu.org/licenses/>.

DIR="$(dirname "$0")"

# HACK: what the fuck, we need to remap this so '<' and '>' aren't both '>'
echo "Fixing keymap..."
xmodmap -e 'keycode 94 = brokenbar'

echo "Starting Dwarf Therapist..."
dwarftherapist >/dev/null 2>&1 &
dt_pid=$!

# Start DF in the foreground
echo "Starting Dwarf Fortress..."
dfhack

# Wait for Therapist to quit
echo "Dwarf Fortress quit; close Therapist and this console to exit."
wait

echo "Dwarf Fortress and Therapist exited; restarting."
sleep 5
exit 0
