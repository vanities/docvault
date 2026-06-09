/* oxlint-disable react-refresh/only-export-components */
import { createElement, type ElementType } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type AnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
};

interface SafeMarkdownProps {
  children: string;
  components?: Components;
  className?: string;
  /** Extra protocols for component-specific handlers, e.g. wiki: in ExternalSourcesView. */
  allowedProtocols?: string[];
}

export function safeMarkdownHref(
  href: string | undefined,
  allowedProtocols: readonly string[] = []
): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;

  // Relative URLs and same-page anchors are safe to leave to the browser.
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../'))
    return trimmed;
  if (trimmed.startsWith('#')) return trimmed;

  try {
    const url = new URL(trimmed);
    const allowed = new Set(['http:', 'https:', 'mailto:', 'tel:', ...allowedProtocols]);
    return allowed.has(url.protocol) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function SafeLink({ href, children, className, ...props }: AnchorProps) {
  const sanitized = safeMarkdownHref(href);
  if (!sanitized) return <span className={className}>{children}</span>;

  const external = /^[a-z][a-z0-9+.-]*:/i.test(sanitized) && !sanitized.startsWith('mailto:');
  return (
    <a
      href={sanitized}
      className={className ?? 'text-accent-400 hover:underline'}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      {...props}
    >
      {children}
    </a>
  );
}

export function SafeMarkdown({
  children,
  components,
  className,
  allowedProtocols = [],
}: SafeMarkdownProps) {
  const userLink = components?.a;
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...components,
          a: ({ href, children: linkChildren, className: linkClassName, ...props }) => {
            const sanitized = safeMarkdownHref(href, allowedProtocols);
            if (!sanitized) return <span className={linkClassName}>{linkChildren}</span>;
            const sanitizedProps = { ...props, href: sanitized, className: linkClassName };
            if (userLink) {
              return createElement(
                userLink as ElementType<AnchorProps>,
                sanitizedProps,
                linkChildren
              );
            }
            return <SafeLink {...sanitizedProps}>{linkChildren}</SafeLink>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
