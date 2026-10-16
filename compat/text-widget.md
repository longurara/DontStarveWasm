# `TextWidget` Native Parity (`0xaa926b71`)

## Binary Evidence (Build `756039`)
- Factory: `Entity.AddTextWidget` (`0x14002f6f0`), component vtable type `0x1400a1950` (`0xaa926b71`), finalizer `0x14003d000`, destructor `0x1400a1960`.
- Internal `TextNode` (`[component + 0x20]`, constructed by `0x1400eebf0`):
  - `+0xd0`: `dirty` (`uint8_t`, default `1`)
  - `+0xd8`: `font_handle` (`int32_t`, default `-1`)
  - `+0xdc`: `size` (`float`, default `10.0f`)
  - `+0xe0`: `squeeze` (`float`, default `1.0f`; `SetHorizontalSqueeze` does not set `dirty`)
  - `+0xe4..+0xe8`: `region` (`float[2]`, default `{FLT_MAX, FLT_MAX}`)
  - `+0xec`: `word_wrap` (`uint32_t`, default `0`; `EnableWordWrap` requires boolean, does not set `dirty`)
  - `+0xf0`: `whitespace_wrap` (`uint8_t`, default `0`; `EnableWhitespaceWrap` requires boolean, does not set `dirty`)
  - `+0xf4`: `h_anchor` (`uint32_t`, default `2`; `SetHAnchor` maps Lua `0->2`, `2->1`, `1|3->0`)
  - `+0xf8`: `v_anchor` (`uint32_t`, default `2`; `SetVAnchor` maps Lua `0->2`, `2->1`, `1|3->0`)
  - `+0xfc`: `colour` (`uint8_t[4]`, default `0xffffffff`, packed via `clamp(x * 255.0f + 0.5f, 0.0f, 255.0f)`)
  - `+0x174`: `auto_region_size` (`uint8_t`, default `1`)
  - `+0x178`: `text` (`std::string`, default `""`, C-string NUL-truncated in `SetString` `0x1400eedc0`)
  - `+0x1a0`: `show_edit_cursor` (`uint8_t`, default `0`; `ShowEditCursor` requires boolean)
  - `+0x1a4`: `cursor_index` (`uint32_t`, default `0`, updated to `uint32_t(text.size())` by `SetString`)
  - `+0x1e8`: `edit_cursor_colour` (`uint8_t[4]`, default `0xffffffff`; `SetEditCursorColour` does not set `dirty`)
- Layout and measurement (`0x1400eee80` `GetRegionSize`, `0x1400eef70` `HasOverflow`, `0x140040210` `MeasureText`, `0x14003ffc0` `LayoutLine`, `0x14003f880` `LayoutWord`, `0x14003f150` `EmitGlyph`).
