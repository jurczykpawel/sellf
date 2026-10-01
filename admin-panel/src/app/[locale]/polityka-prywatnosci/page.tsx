/**
 * /polityka-prywatnosci — legacy path redirect.
 *
 * The legal-engine terms template hardcodes a link to
 * `https://{website}/polityka-prywatnosci` (see legal-engine's
 * packages/templates/src/terms.pl.md.txt), but Sellf only ever had
 * `/privacy`. Without this redirect, that link in every generated Regulamin
 * 404s. Cheap fix on our side; a template-level parameter is a separate,
 * longer-term change in legal-engine.
 */

import { redirect } from 'next/navigation';

export default function PolitykaPrywatnosciRedirect() {
  redirect('/privacy');
}
