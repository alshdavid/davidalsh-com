import * as path from 'node:path'

const Root = path.resolve(__dirname, '..', '..', '..', '..', '..')
const Src = path.join(Root, 'web')
const Blogs = path.join(Src, 'posts')
const Dist = path.join(Root, 'dist')

export const Directories = {
    Root,
    Src,
    Dist,
    Blogs,
}