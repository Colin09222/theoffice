# Shop starter

A working shop: a product grid, a basket, card checkout on Stripe's own page, a thank-you with the order number, and a contact form.
Everything about what is for sale lives in one file, `shop.json`. Change that file and the page, the basket and the checkout all follow.

## shop.json is the catalogue, and it is also the proposal to the boss

```json
{ "currency": "usd", "delivery": "One honest line on delivery, or leave it empty",
  "products": [ { "key": "lavender", "name": "Lavender candle", "description": "One line on what the buyer gets.",
                  "price": 12.00, "priceFrom": "boss", "image": "images/lavender.jpg", "imageKind": "photo", "ships": true } ] }
```

- `key`: short, lowercase letters, digits, - and _. It never changes once the product is on sale.
- `price`: the number a buyer pays, in the catalogue's currency. `priceFrom` is `"boss"` when the boss gave that price, and `"proposed"`
  when the team chose it. A proposed price is labelled "proposed price" on the page until the boss approves it. Never leave a price out
  and never write "coming soon": a price the boss didn't give is a sensible proposal.
- `image`: a file in this project, about 800 px square and under 300 KB. `imageKind` is `"photo"` only for the boss's own photo of the real
  product, and `"illustration"` for anything drawn or generated, which the page then says under the picture.
- `ships`: true for anything posted or delivered. Stripe's page then asks the buyer for their address, and the boss gets it with the order.
- `delivery`: what the boss said about delivery and returns. Leave it empty rather than guess.

When the shop is published, the office puts every product in shop.json in front of the boss for approval (the same as propose_product),
so nobody has to remember to. Nothing is on sale until the boss has connected Stripe on their Payments tab and approved each product.
After that the page shows the approved price and the buttons work, with no change to the site. A new price in shop.json is a new
proposal, and the old price stays on sale until the boss approves the new one.

## What works already, and must keep working

- Before the boss has connected Stripe: every product still shows with its picture and price, the basket works, and instead of card
  payment the basket takes an order request by email (`office.forms.submit('order-enquiry', ...)`), which lands in the boss's inbox.
  The page says so in plain words. It is a finished shop that isn't taking cards yet, not a "coming soon" page.
- Once payments are on: "Pay by card" calls `office.pay.checkout({ items })` and goes to Stripe's page. Back on the site,
  `office.pay.returned()` and `office.pay.order()` show the order number, the lines and the total, and the buyer gets a confirmation
  email from the company. The boss gets the order in their inbox and on their Payments tab, with the address to send it to.
- A local preview has no Office server behind it, so `office.pay.status()` says payments work once published. Test the basket and the
  order request there; the real checkout can only be tried on the published shop.

Keep every `data-office` hook (`products`, `product`, `price`, `add`, `cart-open`, `cart`, `cart-count`, `cart-lines`, `cart-total`,
`checkout`, `order-request`, `order-confirmation`, `shop-status`, `contact-form`, `form-status`): the Tester's script uses them.

Make it this shop: the real products in shop.json, the words from notes/copy.md, the look from notes/design.md (the variables in shop.css,
and the layout: this is a skeleton, not a look). Replace og.svg and favicon.svg. Never invent a review, a stock level, a discount, a
delivery time or a returns promise. Never collect card details on the page.
