---
id: rainsoul-clean-source-install-history
title: 净源码安装与Git历史发布检查
category: bug-patterns
tags: [npm, SQLite, Electron, GitHub, 净安装]
summary: 原工作区能运行不代表净源码可运行；锁文件元数据、运行时下载和历史大对象需独立核验。
source: project-local
date: 2026-10-14
severity: medium
---

# 净源码安装与Git历史发布检查

## 已实测的陷阱

1. npm 11.13 从锁文件构建虚拟依赖树时，better-sqlite3 的上游 `gypfile:false` 缺失会使安装错误执行 node-gyp。本项目保留该标志并用配置回归核对真实manifest，不用全局禁用脚本掩盖问题。
2. Electron 44.7.0 暴露 install-electron 命令但无自动postinstall；项目显式安装运行时，否则仅有npm包仍不能启动。网络受限时镜像需使用固定版本且保留上游校验。
3. ignore与删除HEAD文件不能移除Git历史中的246MB旧EXE；在完整隔离克隆中过滤大blob，逐项核对当前tree相同、远端主线仍为祖先、目标分支可达blob不超100MiB，保留原分支。

## 使用条件

新用户安装、锁文件更新、运行时升级及GitHub首次发布前，在独立源码目录执行npm ci、生产构建、真实启动和保存重启验证。不要把既有node_modules或本机模型复制进去冒充可复现。

证据索引：`tasks/github-readiness-2026-10-14.md`。性能窗口被最小化属于环境失效，应保留证据并复验，不放宽P95门槛。
