---
title: Guided tutorials
description: Clickable walkthroughs of the admin panel that start on your first visit and replay on request.
---

New admin features come with a short walkthrough that highlights the real controls step by step. Each tutorial starts by itself the first time you open its screen and never again unless you ask for it. What you have seen is stored per administrator account, so a colleague still gets their own first-visit tutorial.

Tutorials exist for the product form (its six sections and the "Buyer gets" summary), store templates, product offer pages, the business cart (buyer, recipient, quantity, participants), events with price tiers, bank transfer settings, unpaid transfer orders, the affiliate programme, issued licenses, purchase sources and Payments with Orders.

## Replaying a tutorial

Use the **?** button in the header. It lists the tutorials of the screen you are on and links to the others. The product form, business cart, events and unpaid order tutorials live inside a form or a dialog: replay them with the **Show how this works** button (in the product form next to the scenario, elsewhere next to the section title once that section is open). The product form tutorial starts on its own the first time you open the form. The business cart and event tutorials also start on their own the first time you switch the feature on.

Navigate with the buttons or the arrow keys, close with **Esc**. A step that needs a click on the highlighted control waits until you make it.

## For self-hosters

Tutorials store only which tutorial each administrator account has seen (`tutorial_progress`) and create no sample data. They are part of the admin panel and need no configuration.

## Product editor

The product form has six sections: basics, delivery, checkout data, dates and seats, offer page, and sales and settlement. **What are you selling?** helps start a download, free material, subscription, donation, bundle or event. Changing the scenario shows a preview of the affected settings and requires confirmation; it changes existing fields rather than creating a new product type.

The **Buyer gets** summary follows the product and shop settings, including bank transfer and subscriptions. On phones it can be collapsed. Saving with an error opens the relevant section and focuses the control to correct; the error list links to those controls. Section counters show configured checkout fields and dates.

When a new form opens with the scenario picker, focus starts on its first option. Editing or duplicating a product and creating a new bundle starts on the name field. Moving to another control, including a button, keeps focus there. Closing the dialog returns focus to the button that opened it, including when its content focuses a field automatically. On phones, press **Enter** on **show more** or **show less** to expand or collapse the buyer summary.

Invalid prices, including fractional JPY amounts, ask you to correct the price in **Buyer gets** and are never labelled free. An unchanged saved product closes without a discard warning. Reverting an edit leaves it unchanged; unsaved edits to a saved product’s fields or one-time offer require confirmation before closing. A new or duplicated draft with a name, description or positive price still asks for confirmation before discarding it.

After a product form starts from the **?** menu, close the tutorial and then the form to return focus to **?**. Dialogs from a product’s **…** menu return focus to that row’s **…** button. Product Edit and **…** buttons keep stable identities, so closing a dialog can also return focus after a background list refresh replaced the original button. History confirmations return focus to the chosen revision button on **Esc** or Cancel, including after a delayed comparison read.
