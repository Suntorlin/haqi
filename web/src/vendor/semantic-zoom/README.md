# semantic-zoom (vendored)

Copied from semantic-zoom-react (a React port of semantic_zoom) at `a8797dd`, its `src/` folder.
Local changes (worth sending upstream):
- `ScrollAnchor.pinElement()` (public): the chat holds a message still while it swaps between the word morph and Markdown.
- `bottomEdge` option on `ScrollAnchor` and `useSemanticZoomScroller`: a chat in normal DOM order holds each message's bottom edge, like `reverse`, but keeps extra room after the content.
It is not published to npm. To update, copy `src/` again and note the new commit here.

That package is a React port of the Flutter package semantic_zoom by Roshen De Zoysa (MIT); see LICENSE.
