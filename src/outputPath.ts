import fs from 'node:fs'
import path from 'node:path'

/** Reject an export that would replace the source document, including aliases. */
export function assertDistinctOutputPath(inputPath: string, outputPath: string): void {
  const output = fs.statSync(outputPath, { bigint: true, throwIfNoEntry: false })
  const input = fs.statSync(inputPath, { bigint: true, throwIfNoEntry: false })
  const sameFile = input && output && input.dev === output.dev && input.ino === output.ino
  if (sameFile || path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error(`Output path would overwrite the input document: ${outputPath}`)
  }
}
