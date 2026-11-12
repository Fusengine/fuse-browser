/**
 * Vocabulary of destructive and payment controls, as data. Matched against the
 * accessible name of the live element when the confirmation pause is enabled.
 * Extend the table, not the matcher.
 *
 * Decisions: a bare "remove"/"erase"/"effacer" is NOT matched (it is everywhere:
 * "Remove filter", "Remove tag") — only with a destructive object (account, card,
 * everything...). "Unsubscribe"/"se désabonner" are destructive; a plain
 * "Subscribe" (newsletter) is not a payment and is left out.
 * @module actions/sensitive-vocab
 */
import type { SensitiveRule } from "../interfaces/safe-actions.js";

/** Word-bounded patterns (EN + FR), case-insensitive. */
export const SENSITIVE_RULES: readonly SensitiveRule[] = [
  {
    category: "destructive",
    pattern:
      /\b(delete(?! (this |the |my |a )?(filters?|search|tags?|labels?|criteria))|destroy|wipe|terminate|deactivate|unsubscribe|close (my )?account|cancel (my )?(subscription|order|plan|membership)|(remove|erase) (my |your |the )?(account|profile|card|payment method|all|everything|data|history|user|member)|supprimer(?! (le |la |les |un |une |ce |cette |mon |ma )?(filtres?|recherche|tags?|[ée]tiquettes?|crit[èe]res?))|désactiver|desactiver|résilier|resilier|se d[ée]sabonner|d[ée]sinscrire|effacer (le |mon |ce |tout|toutes|les |mes |l['’]|d['’])?(compte|tout|toutes|donn[ée]es|historique)|retirer (le |mon |ce )?(compte|moyen de paiement))\b/i,
  },
  {
    category: "payment",
    pattern:
      /\b(pay|pay now|buy|buy now|purchase|place (your |my )?order|complete (your |my )?order|checkout|payer|acheter|commander|valider (la |ma )?commande)\b/i,
  },
];

/** The category of the first rule that matches `text`, or `null`. */
export function sensitiveCategory(text: string): SensitiveRule["category"] | null {
  for (const rule of SENSITIVE_RULES) if (rule.pattern.test(text)) return rule.category;
  return null;
}
