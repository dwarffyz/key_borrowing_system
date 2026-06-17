# Linux Setup

## Ubuntu, Debian, Kali

```bash
sudo apt update
sudo apt install -y curl git ca-certificates nodejs npm python3 python3-pip python3-venv build-essential
chmod +x install.sh start.sh update.sh uninstall.sh flash-esp.sh
./install.sh
./start.sh
```

## Arch

```bash
sudo pacman -Sy --needed curl git nodejs npm python python-pip base-devel
chmod +x install.sh start.sh update.sh uninstall.sh flash-esp.sh
./install.sh
./start.sh
```

## Fedora

```bash
sudo dnf install -y curl git nodejs npm python3 python3-pip gcc gcc-c++ make
chmod +x install.sh start.sh update.sh uninstall.sh flash-esp.sh
./install.sh
./start.sh
```

## ESP Serial Permissions

```bash
sudo usermod -aG dialout,uucp $USER
```

Log out and log back in.

