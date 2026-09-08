#!/usr/bin/env node
/** Linux native dependencies must target the approved Ubuntu 22.04 VM.
 * A successful build in Alpine/musl or on ARM is not a compatible VM release.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseOsRelease(source) {
  const fields = {};
  for (const line of source.split('\n')) {
    const match = line.match(/^(ID|VERSION_ID)=(.*)$/);
    if (match) fields[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return fields;
}

export function assertBuildPlatform({
  platform,
  architecture,
  node,
  glibc,
  os,
}) {
  if (platform !== 'linux' || architecture !== 'x64')
    throw new Error('STORE_BUILD_REQUIRES_LINUX_X86_64');
  if (node !== '24.18.0') throw new Error('STORE_BUILD_REQUIRES_NODE_24_18_0');
  if (!glibc) throw new Error('STORE_BUILD_REQUIRES_GLIBC_MUSL_NOT_SUPPORTED');
  if (os.ID !== 'ubuntu' || os.VERSION_ID !== '22.04')
    throw new Error('STORE_BUILD_REQUIRES_UBUNTU_22_04');
  // Pin to the serving VM's distro/runtime ABI. Merely checking "Linux" or
  // allowing a newer glibc can package native modules the VM cannot load.
  if (glibc !== '2.35') throw new Error('STORE_BUILD_REQUIRES_GLIBC_2_35');
  return {
    platform,
    architecture,
    osId: os.ID,
    osVersion: os.VERSION_ID,
    libc: 'glibc',
    glibcVersion: glibc,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const os = parseOsRelease(fs.readFileSync('/etc/os-release', 'utf8'));
    const result = assertBuildPlatform({
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      glibc: process.report.getReport().header.glibcVersionRuntime,
      os,
    });
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      'Store release build requires Ubuntu 22.04 x86_64, Node 24.18.0 and glibc 2.35; Alpine/musl, ARM and newer distro ABIs are refused.'
    );
    process.exitCode = 1;
  }
}
