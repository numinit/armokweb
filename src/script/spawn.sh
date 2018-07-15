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

cat <<EOF
                             __                  ___.    
_____ _______  _____   ____ |  | ____  _  __ ____\\_ |__  
\\__  \\\\_  __ \\/     \\ /  _ \\|  |/ /\\ \\/ \\/ // __ \\| __ \\ 
 / __ \\|  | \\/  Y Y  (  <_> )    <  \\     /\\  ___/| \\_\\ \\ 
(____  /__|  |__|_|  /\\____/|__|_ \\  \\/\\_/  \\___  >___  /
     \\/            \\/            \\/             \\/    \\/ 
EOF

echo
sleep 1

# HACK: what the fuck, we need to remap this so '<' and '>' aren't both '>'
echo "Fixing keymap..."
xmodmap -e 'keycode 94 = brokenbar'

echo "Setting DPI..."
xrandr --dpi 96

TARGET="$1"
echo "Starting $TARGET..."
shift
exec "$TARGET" "$@"
