#!/usr/bin/env bash
# 仓库外备份：git bundle（仅已提交历史）到集中目录。NAS 不可用时的退路；NAS 修好后改为 push + bundle 双写。
# 用法：在项目根目录执行  bash backup.sh
set -e
PROJECT=$(basename "$PWD")
DEST="${BACKUP_DIR:-/d/zcodework/_backups}"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "错误：当前目录不是 git 仓库：$PWD"; exit 1; }
mkdir -p "$DEST"
if [ -n "$(git status --porcelain)" ]; then
    echo "提示：工作区有未提交改动（bundle 只含已提交历史）："
    git status --short | head -5
fi
OUT="$DEST/${PROJECT}-$(date +%Y%m%d-%H%M).bundle"
git bundle create "$OUT" --all
echo "backup ok: $OUT"
