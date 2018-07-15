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

terminal_title=""
exec_child=""

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    -e|--exec)
      exec_child="$2"
      shift 2
      ;;
    -t|--terminal)
      terminal_title="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [ -z "$exec_child" ]; then
    echo "Usage: $0 --exec CHILD [--terminal TERMINAL-TITLE]" >&2
    exit 1
fi

spawn="$DIR/spawn.sh"

if [ -z "$terminal_title" ]; then
    # Run in the foreground
    exec "$spawn" "$exec_child"
else
    exec xterm -T "$terminal_title" -e "$spawn $exec_child"
fi
