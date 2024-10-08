import path from 'node:path';
import * as node_crypto from "node:crypto"
import * as child_process from "node:child_process"
import fs from 'node:fs';
import * as url from 'node:url';
import { createRequire } from 'node:module';
import * as glob from 'glob'
import moment from 'moment'
import * as ejs from 'ejs'
import * as sass from 'sass'
import * as esbuild from 'esbuild'
import * as prettier from 'prettier'
import { Markdown } from './markdown/markdown.js';
import * as paths from '../platform/paths.js';

console.clear()

const PROD = process.env.PROD === 'true'
const URL = process.env.URL || 'http://localhost:8080'

console.log({ PROD, URL })

fs.rmSync(paths.__dist, { recursive: true, force: true })

let index_files = glob.sync("**/index.ejs", {
  cwd: paths.__src
})

let scripts = new Map<string, Promise<string>>()
let styles = new Map<string, Promise<string>>()
let assets = new Set<string>()
let index = {}
let virtual_assets = new Map<string, Buffer>()

const templates: Array<Promise<void>> = []

for (const index_file of index_files) {
  templates.push((async () => {
    const slug = path.dirname(index_file) === "." ? "/" : '/' + path.dirname(index_file);

    let path_abs_index_file = path.join(paths.__src, index_file);
    let file = path.parse(index_file)
    let contents = fs.readFileSync(path_abs_index_file, 'utf-8')

    index[slug] = {}

    let local_index = {
      set(key: any, data?: any) {
        index[slug][key] = data
      }
    }

    let local_scripts = {
      add: async (str: string, options: { wrap?: boolean, rename?: boolean } = { wrap: false, rename: true }) => {
        let script_path = str
        if (!path.isAbsolute(script_path)) {
          script_path = path.normalize(path.join(paths.__src, file.dir, str))
        }

        if (!scripts.has(script_path)) {
          scripts.set(script_path, (async () => {
            let rel_path = path.relative(paths.__src, path.dirname(script_path))

            const result = await esbuild.build({
              entryPoints: [script_path],
              minify: true,
              metafile: true,
              format: 'esm',
              bundle: true,
              outdir: path.join(paths.__dist, rel_path),
              write: true
            })
            
            const out_path = path.join(paths.__root, Object.keys(result.metafile.outputs)[0]);
            
            if (options.rename) {
              const file = await fs.promises.readFile(out_path)
              const hash = node_crypto.createHash('sha256').update(file).digest('hex').substring(0,20)
              const out_path_hash = path.join(path.dirname(out_path), `${hash}.js`);
              await fs.promises.rename(out_path, out_path_hash)
              return `${hash}.js`
            }
        
            let script_path_2 = path.relative(path.dirname(path_abs_index_file), out_path)
            
            return script_path_2
          })())
        }

        const out_path = await scripts.get(script_path)!

        let rel_path = path.relative(path.dirname(path_abs_index_file), path.join(paths.__src, out_path))
        if (options.wrap) {
          return `<script src="${rel_path}" type="module" async></script>`
        } else {
          return rename_ext(rel_path, 'js')
        }
      }
    }

    let local_styles = {
      add: async (str: string, options: { wrap?: boolean, rename?: boolean } = { wrap: false, rename: true }) => {
        let script_path = str
        if (!path.isAbsolute(script_path)) {
          script_path = path.normalize(path.join(paths.__src, file.dir, str))
        }

        if (!styles.has(script_path)) {
          styles.set(script_path, (async () => {
            let rel_path = path.relative(paths.__src, path.dirname(script_path))
            
            const raw = await fs.promises.readFile(script_path, { encoding: 'utf8' })
            const result = await sass.compileStringAsync(raw, {
              url: url.pathToFileURL(script_path),
            })
            const content = result.css.toString()

            let filename = `index.css`

            if (options.rename) {
              const hash = node_crypto.createHash('sha256').update(content).digest('hex').substring(0,20)
              filename = `${hash}.css`
            }

            let output_path_file_abs = path.join(paths.__dist, rel_path, filename)
            let output_path_dir_abs = path.dirname(output_path_file_abs)

            if (!fs.existsSync(output_path_dir_abs)) {
              await fs.promises.mkdir(output_path_dir_abs, { recursive: true })
            }
            await fs.promises.writeFile(output_path_file_abs, content, 'utf8')
                                    
            return path.relative(paths.__dist, output_path_file_abs)
          })())
        }

        const out_path = await styles.get(script_path)!
        let rel_path = path.relative(path.dirname(path_abs_index_file), path.join(paths.__src, out_path))

        if (options.wrap) {
          return `<link rel="stylesheet" href="${rel_path}" />`
        } else {
          return rename_ext(rel_path, 'css')
        }
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
          md_path = path.normalize(path.join(paths.__src, file.dir, str))
        }
        return Markdown.render([md_path], ctx)
      }
    }

    const local_require = createRequire(path.dirname(path_abs_index_file))

    const git_changes = child_process
      .execSync(`git log --follow --format=%ad --date iso-strict ${path_abs_index_file}`)
      .toString().trim().split('\n').map(ds => moment(ds))

    const ctx = {
      changes: git_changes,
      util: {
        path,
        moment,
        query: (obj: any) => new URLSearchParams(obj).toString()
      },
      paths: {
        root: paths.__src,
        dirname: path.dirname(path_abs_index_file)
      },
      index_meta: local_index,
      url: URL,
      slug_full: path.dirname(index_file) === "." ? URL : URL + slug + '/',
      slug,
      scripts: local_scripts,
      styles: local_styles,
      assets: local_assets,
      virtual_assets: local_virtual_assets,
      markdown: local_markdown,
      require: (str: string) => local_require(path.join(path.dirname(path_abs_index_file), str)),
      get ctx() {
        return this 
      }
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

    const hash = node_crypto.createHash('sha256').update(result).digest('hex').substring(0,20)
    local_index.set("hash", hash)

    fs.mkdirSync(path.join(paths.__dist, file.dir), { recursive: true })
    fs.writeFileSync(path.join(paths.__dist, file.dir, rename_ext(file.name, 'html')), result, 'utf-8')
  })())
}

await Promise.all(templates)

for (const [_, asset] of assets.entries()) {
  let outdir = path.join(paths.__dist, path.dirname(asset))
  fs.mkdirSync(outdir, { recursive: true })
  if (PROD) {
    fs.cpSync(path.join(paths.__src, asset), path.join(outdir, path.basename(asset)), { recursive: true })
  } else {
    fs.symlinkSync(path.join(paths.__src, asset), path.join(outdir, path.basename(asset)))
  }
}

for (const [filepath, data] of virtual_assets.entries()) {
  let outdir = path.join(paths.__dist, path.dirname(filepath))
  fs.mkdirSync(outdir, { recursive: true })
  fs.writeFileSync(path.join(outdir, path.basename(filepath)), data, 'binary')
}

fs.writeFileSync(path.join(paths.__dist, 'index.json'), JSON.stringify(index, null, 2), 'utf8')

function rename_ext(t: string, w: string): string {
  let file = path.parse(t)
  return path.join(file.dir, `${file.name}.${w}`)
} 
