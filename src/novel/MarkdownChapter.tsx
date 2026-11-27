import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { createElement, Fragment, memo, type ReactNode, useMemo } from 'react'

import { httpUrl } from '../../shared/fields'

// R-399: a Markdown file as React elements. The parser has HTML switched off (raw HTML stays literal text), the tokens
// are mapped to a short list of elements here (no innerHTML, no scripts, styles or event handlers from the file),
// pictures are never loaded (the alt text is shown instead), and a link opens in the system browser only when it is
// http or https; the window itself never navigates.
const parser = new MarkdownIt('default', { html: false, linkify: false, typographer: false })

const tags: Record<string, string> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bullet_list: 'ul',
  ordered_list: 'ol',
  list_item: 'li',
  table: 'table',
  thead: 'thead',
  tbody: 'tbody',
  tr: 'tr',
  th: 'th',
  td: 'td',
  em: 'em',
  strong: 'strong',
  s: 's',
  heading: 'h',
}

type Open = (url: string) => void

function inline(tokens: Token[], open: Open, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const stack: { tag: string; props: Record<string, unknown>; children: ReactNode[] }[] = []
  const push = (node: ReactNode) =>
    (stack.length ? stack[stack.length - 1].children : out).push(node)
  tokens.forEach((token, index) => {
    const id = key + '-' + index
    if (token.type === 'text') push(token.content)
    else if (token.type === 'code_inline') push(<code key={id}>{token.content}</code>)
    else if (token.type === 'softbreak') push('\n')
    else if (token.type === 'hardbreak') push(<br key={id} />)
    else if (token.type === 'image') push(token.content ? `[${token.content}]` : '')
    else if (token.type === 'link_open') {
      const href = token.attrGet('href') ?? ''
      stack.push({ tag: 'a', props: { key: id, 'data-href': href }, children: [] })
    } else if (token.type === 'link_close' || token.type.endsWith('_close')) {
      const top = stack.pop()
      if (!top) return
      if (top.tag === 'a') {
        const href = String(top.props['data-href'])
        // Only http(s) links work; any other kind is plain text, not a link.
        push(
          httpUrl(href) ? (
            <a
              key={top.props.key as string}
              role="link"
              tabIndex={0}
              title={href}
              className="novel-md-link"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                open(href)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                event.stopPropagation()
                open(href)
              }}
            >
              {top.children}
            </a>
          ) : (
            <span key={top.props.key as string}>{top.children}</span>
          )
        )
      } else push(createElement(top.tag, top.props, top.children))
    } else if (token.type.endsWith('_open')) {
      const name = token.type.slice(0, -5)
      if (tags[name]) stack.push({ tag: tags[name], props: { key: id }, children: [] })
    } else if (token.content) push(token.content)
  })
  while (stack.length) {
    const top = stack.pop()!
    push(
      createElement(
        top.tag === 'a' ? 'span' : top.tag,
        { key: top.props.key as string },
        top.children
      )
    )
  }
  return out
}

// Blocks: opened tags nest, so a stack builds the tree; inline content comes from the token's children.
function blocks(tokens: Token[], open: Open): ReactNode[] {
  const root: ReactNode[] = []
  const stack: { tag: string; props: Record<string, unknown>; children: ReactNode[] }[] = []
  const push = (node: ReactNode) =>
    (stack.length ? stack[stack.length - 1].children : root).push(node)
  tokens.forEach((token, index) => {
    const id = 'b' + index
    // A tight list has no paragraph around an item's text.
    if (token.hidden && token.type.startsWith('paragraph_')) return
    if (token.type === 'inline') {
      push(<Fragment key={id}>{inline(token.children ?? [], open, id)}</Fragment>)
    } else if (token.type === 'fence' || token.type === 'code_block') {
      push(
        <pre key={id}>
          <code>{token.content}</code>
        </pre>
      )
    } else if (token.type === 'hr') push(<hr key={id} />)
    else if (token.type === 'html_block') push(<pre key={id}>{token.content}</pre>)
    else if (token.type === 'heading_open') {
      stack.push({
        tag: token.tag === 'h1' || token.tag === 'h2' || token.tag === 'h3' ? token.tag : 'h4',
        props: { key: id },
        children: [],
      })
    } else if (token.type.endsWith('_open')) {
      const name = token.type.slice(0, -5)
      if (tags[name]) {
        stack.push({
          tag: tags[name],
          props: {
            key: id,
            ...(name === 'ordered_list' && token.attrGet('start')
              ? { start: Number(token.attrGet('start')) || 1 }
              : {}),
          },
          children: [],
        })
      }
    } else if (token.type.endsWith('_close')) {
      const top = stack.pop()
      if (top) push(createElement(top.tag, top.props, top.children))
    }
  })
  return root
}

export const MarkdownChapter = memo(function MarkdownChapter({ text }: { text: string }) {
  const content = useMemo(
    () =>
      blocks(parser.parse(text, {}), (url) => {
        void window.explorer.request({ action: 'openExternal', url }).catch(() => {})
      }),
    [text]
  )
  return <div className="novel-md">{content}</div>
})
