/** Shared look for every floating panel (select, menus, palette) so they read as one family. */
export const panel =
  'z-50 origin-[var(--radix-popper-transform-origin)] rounded-md border border-line-strong bg-surface-raised p-1.5 text-fg shadow-pop ' +
  'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out';

export const item =
  'relative flex h-10 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-sm text-fg outline-none ' +
  'transition-colors duration-75 focus-visible:shadow-none data-[highlighted]:bg-accent-lo data-[highlighted]:text-accent-hi ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[state=checked]:font-medium';
