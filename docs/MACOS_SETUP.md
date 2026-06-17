# macOS Setup

```bash
brew install node python git
chmod +x install.sh start.sh flash-esp.sh
SKIP_SYSTEM_PACKAGES=1 ./install.sh
./start.sh
```

For ESP flashing, install ESP-IDF and source its environment:

```bash
. $HOME/esp/esp-idf/export.sh
./flash-esp.sh --port /dev/cu.usbserial-0001
```

Use MongoDB Atlas or a local MongoDB service for the database.

