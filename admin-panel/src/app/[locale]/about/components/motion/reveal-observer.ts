/**
 * Shared IntersectionObserver for scroll-triggered reveals.
 * One observer instance handles ALL reveal elements on the page.
 * Elements get `.in-view` class added when they enter the viewport.
 */

let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver {
  if (observer) return observer;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer!.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '-60px 0px', threshold: 0 }
  );

  return observer;
}

export function observeReveal(el: HTMLElement): void {
  getObserver().observe(el);
}

export function unobserveReveal(el: HTMLElement): void {
  if (observer) observer.unobserve(el);
}
