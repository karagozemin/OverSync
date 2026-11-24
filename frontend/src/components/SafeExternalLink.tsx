import type { AnchorHTMLAttributes, ReactNode } from 'react';

type SafeExternalLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'rel' | 'target'> & {
  href: string;
  children: ReactNode;
};

/**
 * Use for every link that opens in a new tab. `target` and `rel` are set here
 * (after the other anchor props) so call sites cannot accidentally drop the
 * tabnabbing protection. `noopener` stops the new tab from reaching
 * `window.opener`, and `noreferrer` withholds the referrer.
 */
export default function SafeExternalLink({ href, children, ...anchorProps }: SafeExternalLinkProps) {
  return (
    <a {...anchorProps} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
