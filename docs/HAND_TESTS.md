# Hand test checklist

1. **Photo preset on a phone:** open `#/presets`, choose **Photo under 50 KB**, edit nothing, and apply it to a large phone photo. Confirm the real conversion queue outputs JPG under 50 KB. If the image cannot reach the target at the current dimensions/quality, verify the converter reports that honestly rather than claiming success. This integration check needs the app's actual image converter.
2. **Preset editing:** change the max KB, width, or quality, select **Save to My presets**, reload the page, and check the saved values persist. Check custom presets survive reload and are removed by **Clear all local data**.
3. **Privacy Proof:** open `#/proof` and confirm browser-reported same-origin requests appear under **Our own files**. Confirm only explicitly configured approved engine origins appear under **Engine downloads (you approved these)**. Review any **Other reported requests** rather than hiding them. Compare against DevTools → Network.
4. **Offline check:** after loading the app and any approved engine, enable airplane mode and perform a conversion that should be locally supported. Confirm it works or gives an honest unavailable-engine message. Reconnect afterwards.
5. **Static check:** run `python tools/verify_no_upload.py`. Review any match manually; no static scan can observe runtime request bodies.
6. **Receipt:** complete a batch, click **Make a receipt**, confirm the card uses the completed jobs' actual byte counters, contains `0 bytes uploaded`, and a `lokalconver-receipt.png` is created or offered in the native share sheet. Test one output larger than the input too.
7. **Stats and settings:** convert two files and verify Files converted and Net MB saved change in Settings. Check dark/light/system theme, all four accent colours, sound on/off state, and all three motion modes. Click **Clear all local data**, confirm, and verify saved presets, stats, and settings are gone.
8. **PDF tools:** open `#/pdf`. Merge two PDFs and move one with the arrow keys on its drag handle; split `1-2,4`; rotate one page; compress a scanned PDF to a size goal; turn a PDF into JPGs. Open every result in a PDF viewer. Then try a locked PDF and a renamed non-PDF and read the messages. On a phone, also try "PDF under 500 KB" from the Presets page on a real scan.
9. **Narrow viewport and keyboard:** test at 360 px wide, tab through all controls, use Enter/Space, close Settings with Escape, and check focus outlines.

## Already checked in a real browser (Chromium, 390 px and 360 px wide)
Photo under 50 KB on a 4.8 MB JPG gave 48 KB. The receipt PNG was created. The Proof page listed own files and
the HEIC/engine group, with no request to other addresses. Accent and theme stayed after a reload. No page scrolls
sideways at 360 px. Please still repeat the first test on a real phone photo, and test HEIC and an email batch by hand.
