---
id: "20261115uy0k"
title: At what address should the public map page live?
status: resolved
kind: choice
priority: normal
created: 2026-11-15T03:58:55Z
created_by: claude-code
tags: [map, hosting]
depends_on: []
recommendation:
  option: firebase-hosting
  why: >-
    It gives the map the app's name as its address at no cost, in the Firebase project that
    already holds the data. If you'd rather not grant the deploy account a new role, pick
    github-pages; pick own-domain if you want an address to print on stickers or a crag guide.
options:
  - id: firebase-hosting
    title: tem-sinal.web.app, on Firebase Hosting
    summary: >-
      A Hosting site named tem-sinal in the existing Firebase project (unclaimed today; if
      taken, a near variant such as temsinal); the Deploy workflow publishes map/public/ on merge.
    pros:
      - The address is the app's name, with no personal name in it
      - Same project and same deploy as the functions and the data
    cons:
      - "You run two commands once, signed in as yourself: create the site and give the deploy account the Firebase Hosting Admin role"
      - Past about 10 GB a month of transfer, US$0.15 a GB (the page is under 20 KB a visit)
  - id: github-pages
    title: alexandreffaria.github.io/tem-sinal, on GitHub Pages
    summary: A workflow in this repo publishes map/public/ to GitHub Pages on each merge that changes it.
    pros:
      - No Google Cloud permission to grant and no bill
      - "One switch: Settings > Pages > Source: GitHub Actions"
    cons:
      - Your GitHub username is in the address
      - Soft limit of about 100 GB a month of bandwidth
  - id: own-domain
    title: A domain of its own, such as temsinal.com.br
    summary: >-
      You register a domain (registro.br, about R$40 a year, needs your CPF) and point it at
      either host above; the page is the same.
    pros:
      - Short and easy to say out loud
      - Links people share survive a later move to another host
    cons:
      - Costs money every year, and lapses if not renewed
      - "Your steps: register it and add DNS records, plus the chosen host's setup"
resolution:
  choice: github-pages
  resolved_at: 2026-11-15T04:40:53Z
applied_at: 2026-11-16T00:34:28Z
---

## Context

The public map page is built and tested with made-up cells, but has no address yet. The page
only reads public files, so where it lives changes the link people share, not what they see.
