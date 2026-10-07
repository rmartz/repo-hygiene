# Dependabot sensor for the actionlint version the `actionlint` check pins.
#
# Nothing builds this image. Dependabot's `docker` ecosystem watches the FROM tag
# below; when it bumps it, test/checks/actionlint-release.test.ts fails until
# src/checks/actionlint-release.ts is regenerated to match:
#
#   node scripts/update-actionlint.mjs <version>
#
# See docs/checks/actionlint.md.
FROM rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
