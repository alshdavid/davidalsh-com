import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as glob from 'glob'
import * as ejs from 'ejs'
import * as esbuild from 'esbuild'
import * as prettier from 'prettier'
import { Markdown } from './markdown/markdown';
import {sassPlugin} from 'esbuild-sass-plugin'

const PROD = process.env.PROD === 'true'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); 
const __root = path.join(__dirname, ".."); 
const __src = path.join(__root, "src"); 
const __dist = path.join(__root, "dist");

fs.rmSync(__dist, { recursive: true, force: true })

let index_files = glob.sync("**/index.ejs", {
  cwd: path.join(__dirname, "..", "src")
})

let scripts = new Set<string>()
let styles = new Set<string>()
let assets = new Set<string>()
let virtual_assets = new Map<string, Buffer>()

for (const index_file of index_files) {
  let path_abs_index_file = path.join(__src, index_file);
  let file = path.parse(index_file)
  let contents = fs.readFileSync(path_abs_index_file, 'utf-8')

  let local_scripts = {
    add: (str: string) => {
      let script_path = str
      if (!path.isAbsolute(script_path)) {
        script_path = path.normalize(path.join(__src, file.dir, str))
      }
      scripts.add(script_path)
      let rel_path = path.relative(path.dirname(path_abs_index_file), script_path)
      return `<script src="${rename_ext(rel_path, 'js')}" type="module" async></script>`
    }
  }

  let local_styles = {
    add: (str: string) => {
      let style_path = str
      if (!path.isAbsolute(style_path)) {
        style_path = path.normalize(path.join(__src, file.dir, str))
      }
      styles.add(style_path)
      let rel_path = path.relative(path.dirname(path_abs_index_file), style_path)
      return `<link rel="stylesheet" href="${rename_ext(rel_path, 'css')}" />`
    }
  }

  let local_assets = {
    add: (str: string) => {
      let files = glob.sync(str, {
        dot: true,
        cwd: path.dirname(path_abs_index_file)
      })
      for (const asset of files) {
        assets.add(path.normalize(path.join(file.dir, asset)))
      }
    }
  }

  let local_virtual_assets = {
    set: (str: string, contents: Buffer) => {
      virtual_assets.set(path.normalize(path.join(file.dir, str)), contents)
    }
  }

  let local_markdown = {
    render: (str: string) => {
      let md_path = str
      if (!path.isAbsolute(md_path)) {
        md_path = path.normalize(path.join(__src, file.dir, str))
      }
      return Markdown.render([md_path], ctx)
    }
  }



  const local_require = createRequire(path.dirname(path_abs_index_file))

  const ctx = {
    paths: {
      root: __src,
      dirname: path.dirname(path_abs_index_file)
    },
    scripts: local_scripts,
    styles: local_styles,
    assets: local_assets,
    virtual_assets: local_virtual_assets,
    markdown: local_markdown,
    require: (str: string) => local_require(path.join(path.dirname(path_abs_index_file), str))
  }

  let result = await ejs.render(contents, ctx, {
    async: true,
    cache: false,
    filename: path_abs_index_file,
  })

  if (!result.startsWith('<!DOCTYPE html>')) {
    result = `<!DOCTYPE html>\n<html lang="en">\n${result}\n</html>`
  }

  result = await prettier.format(result, { parser: 'html' })

  fs.mkdirSync(path.join(__dist, file.dir), { recursive: true })
  fs.writeFileSync(path.join(__dist, file.dir, rename_ext(file.name, 'html')), result, 'utf-8')
}

for (const [_, script_file] of scripts.entries()) {
  let rel_path = path.relative(__src, path.dirname(script_file))

  esbuild.buildSync({
    entryPoints: [script_file],
    bundle: true,
    outdir: path.join(__dist, rel_path),
    write: true
  })
}

for (const [_, style_file] of styles.entries()) {
  let rel_path = path.relative(__src, path.dirname(style_file))

  await esbuild.build({
    entryPoints: [style_file],
    bundle: true,
    outdir: path.join(__dist, rel_path),
    plugins: [
      sassPlugin()
    ],
    write: true
  })
}

for (const [_, asset] of assets.entries()) {
  let outdir = path.join(__dist, path.dirname(asset))
  fs.mkdirSync(outdir, { recursive: true })
  if (PROD) {
    fs.cpSync(path.join(__src, asset), path.join(outdir, path.basename(asset)))
  } else {
    fs.symlinkSync(path.join(__src, asset), path.join(outdir, path.basename(asset)))
  }
}

for (const [filepath, data] of virtual_assets.entries()) {
  let outdir = path.join(__dist, path.dirname(filepath))
  fs.mkdirSync(outdir, { recursive: true })
  fs.writeFileSync(path.join(outdir, path.basename(filepath)), data, 'binary')
}


function rename_ext(t: string, w: string): string {
  let file = path.parse(t)
  return path.join(file.dir, `${file.name}.${w}`)
} 