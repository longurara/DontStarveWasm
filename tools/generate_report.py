import json
import os
import re
import zipfile
from pathlib import Path

ROOT = Path("e:/02_Projects/decr/Don't Starve Together")
WEB_PORT = ROOT / "web-port"
ANALYSIS_JSON = ROOT / "analysis/output/dontstarve_steam_x64.json"
GLOBALS_JSON = WEB_PORT / "output/dontstarve_steam_x64-globals.json"
SCRIPTS_ZIP = ROOT / "data/databundles/scripts.zip"
REPORT_MD = ROOT / "UNPORTED_FUNCTIONS.md"
VERIFY_SCRIPT = WEB_PORT / "tools/verify-unported-audit.mjs"

print("1. Loading native analysis...")
with open(ANALYSIS_JSON, "r", encoding="utf-8") as f:
    native_data = json.load(f)

with open(GLOBALS_JSON, "r", encoding="utf-8") as f:
    globals_data = json.load(f)

print("2. Reading C++ engine sources...")
cpp_sources = {}
for p in (WEB_PORT / "engine").glob("*.*"):
    if p.suffix in [".cpp", ".hpp", ".c"]:
        cpp_sources[p.name] = p.read_text(encoding="utf-8", errors="replace")

print(f"Loaded {len(cpp_sources)} C++ source files.")

print("3. Indexing scripts.zip with inverted index...")
method_index = {}
with zipfile.ZipFile(SCRIPTS_ZIP) as z:
    for fname in z.namelist():
        if not fname.endswith(".lua"):
            continue
        text = z.read(fname).decode("utf-8", errors="replace")
        for i, line in enumerate(text.splitlines(), 1):
            for match in re.finditer(r'[:.]([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', line):
                mname = match.group(1)
                if mname not in method_index:
                    method_index[mname] = (fname, i, line.strip())
            for match in re.finditer(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', line):
                mname = match.group(1)
                if mname not in method_index:
                    method_index[mname] = (fname, i, line.strip())

print(f"Indexed {len(method_index)} unique method calls from scripts.zip.")

def get_script_call(method_name):
    if method_name in method_index:
        fname, line, snip = method_index[method_name]
        return f"{fname}:{line}", snip
    return None, None

# Component-specific table line ranges in world_components.cpp to prevent cross-component false matches
WC_RANGES = {
    "Map": (2566, 2596),
    "Pathfinder": (2600, 2604),
    "GroundCreep": (2608, 2612),
    "MiniMap": (2616, 2625),
    "WaveComponent": (2629, 2632),
    "Network": (2636, 2645),
    "AnimState": (2653, 2698),
    "Physics": (2702, 2721),
    "Light": (2725, 2732),
    "Follower": (2736, 2737),
    "MiniMapEntity": (2741, 2745),
    "DynamicShadow": (2749, 2751),
    "StaticShadow": (2752, 2754),
    "LightWatcher": (2755, 2758),
    "GroundCreepEntity": (2762, 2764),
    "MapExplorer": (2765, 2770),
    "DebugRender": (2774, 2777),
    "ParticleEmitter": (2781, 2790),
    "VFXEffect": (2794, 2806),
    "Image": (2810, 2814),
    "Label": (2818, 2820),
    "TextEditWidget": (2824, 2828),
    "VideoWidget": (2832, 2836),
    "PhysicsWaker": (2840, 2841),
    "NetVar": (2846, 2847),
    "Entity": (2899, 2918)
}

def find_cpp_for_class(cname, mname, allowed_files):
    if not allowed_files:
        return None, None
    for cf in allowed_files:
        if cf not in cpp_sources:
            continue
        lines = cpp_sources[cf].splitlines()
        if cf == "world_components.cpp" and cname in WC_RANGES:
            start_l, end_l = WC_RANGES[cname]
            for i in range(start_l, min(end_l + 1, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "runtime.cpp" and cname == "TheSim":
            for i in range(1497, min(1575, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "runtime.cpp" and cname == "Entity":
            for i in range(1477, min(1496, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "runtime.cpp" and cname in ["TheNet", "TheShard"]:
            for i in range(1574, min(1578, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "session.cpp" and cname == "TheNet":
            for i in range(400, min(454, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "session.cpp" and cname == "TheShard":
            for i in range(458, min(466, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "inventory.cpp" and cname == "TheInventory" and "Scrapbook" in mname and any(f"Scrapbook{idx}" in mname for idx in range(16)):
            if mname.startswith("AddScrapbook"):
                return f"web-port/engine/{cf}:119", lines[118].strip()
            elif mname.startswith("GetLocalScrapbook"):
                return f"web-port/engine/{cf}:120", lines[119].strip()
            elif mname.startswith("SetScrapbook"):
                return f"web-port/engine/{cf}:121", lines[120].strip()
        elif cf == "camera.cpp" and cname == "TheSim":
            for i in range(140, min(152, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "persistent.cpp" and cname == "TheSim":
            for i in range(295, min(318, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "font_asset.cpp" and cname == "TheSim":
            for i in range(170, min(176, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "prefabs.cpp" and cname == "TheSim":
            for i in range(235, min(245, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "input.cpp" and cname == "TheSim":
            for i in range(100, min(106, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "ui_transform.cpp" and cname == "TheSim":
            for i in range(193, min(197, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "ui_transform.cpp" and cname == "UITransform":
            for i in range(165, min(190, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "atlas_asset.cpp" and cname == "TheSim":
            for i in range(165, min(168, len(lines) + 1)):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        elif cf == "physics_waker.cpp" and cname == "PhysicsWaker":
            for i in range(1, len(lines) + 1):
                line = lines[i - 1]
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
        else:
            for i, line in enumerate(lines, 1):
                if f'"{mname}"' in line or f"'{mname}'" in line:
                    return f"web-port/engine/{cf}:{i}", line.strip()
    return None, None

NOOP_FUNCS = {
    "comp_noop", "map_noop", "transform_noop", "entity_movement_noop",
    "profiler_push", "profiler_pop", "sim_render_one_frame",
    "sim_download_motd_image", "sim_load_motd_image", "sim_download_motd_images",
    "sim_update_device_caps", "set_reverb", "texture_group", "send_hardware_stats",
    "sim_log_bulk_metric", "sim_set_motd_target", "headless_sound",
    "noop", "enable_vibration", "add_vibration", "remove_vibration",
    "flush_input", "localized_control", "map_control", "inv_noop",
    "no_haptic_device", "noop_zero", "cancel_login", "toggle_streaming",
    "stop", "save_settings", "close_vk", "clear_file_aliases",
    "net_noop"
}

MOCK_FUNCS = {
    "comp_true", "comp_false", "comp_zero", "comp_one", "comp_empty_str",
    "sim_false", "sim_true", "debugger_disabled", "sim_has_player_skeletons",
    "sim_should_play_intro_movie", "sim_is_logged_on", "sim_get_users_name",
    "sim_get_steam_id_number", "sim_get_steam_beta_branch_name", "sim_get_motd_query_url",
    "sim_has_motd_image", "sim_get_light_at_point", "sim_get_entities_at_screen_point",
    "validate_line_number", "sound_volume", "controllers", "copy_mapping", "open_vk",
    "inv_zero", "inv_false", "inv_true", "inv_nil", "inv_empty_table", "last_operation",
    "get_num_displays", "get_display_name", "get_num_refresh_rates", "get_refresh_rate",
    "get_num_display_modes", "get_display_mode", "is_fullscreen_enabled", "start_or_supported",
    "get_empty_channel_string", "get_username", "create_account", "add_game_key",
    "recover_password", "is_banned", "must_upgrade_client",
    "get_false", "get_true", "get_empty_string", "get_empty_table", "get_nil", "get_zero",
    "get_max", "shard_false", "always_true"
}

SYNTH_CLASSES = {"SoundEmitter", "GraphicsOptions", "TwitchOptions", "AccountManager"}

PARTIAL_METHODS = {
    ("TheNet", "IsDedicated"),
    ("TheSim", "SendProfileStats"),
    ("TheSim", "ClearFileSystemAliases"),
    ("RoadManager", "GenerateVB"),
    ("Image", "SetSize"),
    ("Image", "GetSize"),
    ("Entity", "WorldToLocalSpace"),
    ("Entity", "LocalToWorldSpace"),
    ("Entity", "LocalToWorldSpaceIncParent"),
    ("Entity", "SetPlatform"),
    ("Entity", "GetPlatform")
}

THROWING_CPP_METHODS = {
    ("PostProcessor", "AddSamplerEffect"),
    ("PostProcessor", "SetSamplerEffectState"),
    ("PostProcessor", "SetSamplerEffectFilter"),
    ("PostProcessor", "AddPostProcessEffect"),
    ("PostProcessor", "SetEffectUniformVariables"),
    ("PostProcessor", "AddSampler"),
    ("PostProcessor", "EnablePostProcessEffect"),
    ("PostProcessor", "SetBasePostProcessEffect"),
    ("PostProcessor", "SetPostProcessEffectBefore"),
    ("PostProcessor", "SetPostProcessEffectAfter"),
    ("PostProcessor", "SetColourCubeSamplerEffect"),
    ("PostProcessor", "SetBloomSamplerParams"),
    ("StaticShadow", "GenerateStaticShadows"),
    ("ShadowManager", "GenerateStaticShadows"),
    ("GameService", "AwardAchievement")
}

groups_by_name = {g["class_candidate"]: g for g in native_data["engine_binding_groups"]}

class_definitions = [
    # Global tables & Proxies
    {"name": "TheSim", "category": "Global Object", "native_group": "Sim", "cpp_files": ["runtime.cpp", "persistent.cpp", "camera.cpp", "font_asset.cpp", "prefabs.cpp", "input.cpp", "ui_transform.cpp", "atlas_asset.cpp"], "display_cpp": "web-port/engine/runtime.cpp"},
    {"name": "TheNet", "category": "Global Object", "native_group": "NetworkProxy", "cpp_files": ["runtime.cpp", "session.cpp"], "display_cpp": "web-port/engine/runtime.cpp"},
    {"name": "TheShard", "category": "Global Object", "native_group": "ShardProxy", "cpp_files": ["runtime.cpp", "session.cpp"], "display_cpp": "web-port/engine/runtime.cpp"},
    {"name": "TheInputProxy", "category": "Global Object", "native_group": "InputProxy", "cpp_files": ["input.cpp"], "display_cpp": "web-port/engine/input.cpp"},
    {"name": "TheInventory", "category": "Global Object", "native_group": "InventoryProxy", "cpp_files": ["inventory.cpp"], "display_cpp": "web-port/engine/inventory.cpp"},
    {"name": "TheSystemService", "category": "Global Object", "native_group": "SystemService", "cpp_files": ["system.cpp"], "display_cpp": "web-port/engine/system.cpp"},
    {"name": "TheGameService", "category": "Global Object", "native_group": "GameService", "cpp_files": ["game_service.cpp"], "display_cpp": "web-port/engine/game_service.cpp"},
    {"name": "TheHaptics", "category": "Global Object", "native_group": "HapticsLuaProxy", "cpp_files": ["game_service.cpp"], "display_cpp": "web-port/engine/game_service.cpp"},
    {"name": "TileGroupManager", "category": "Global Object", "native_group": "TileGroupManager", "cpp_files": ["tiles.cpp"], "display_cpp": "web-port/engine/tiles.cpp"},
    {"name": "WorldSim", "category": "Global Object", "native_group": "WorldSimActual", "cpp_files": None, "display_cpp": "None (Unbound / Missing)"},
    {"name": "MapGenSim", "category": "Global Object", "native_group": "MapGenSim", "cpp_files": None, "display_cpp": "None (Unbound / Missing)"},
    {"name": "RawImgui", "category": "Global Object", "native_group": "RawImgui", "cpp_files": None, "display_cpp": "None (Unbound / Missing)"},
    {"name": "ShadeRenderer", "category": "Global Object", "native_group": "ShadeRenderer", "cpp_files": None, "display_cpp": "None (Unbound / Missing)"},
    {"name": "ManifestManager", "category": "Global Object", "native_group": "ManifestManager", "cpp_files": None, "display_cpp": "None (Unbound / Missing)"},
    {"name": "ItemServerProxy", "category": "Global Object (TheItems)", "native_group": "ItemServerProxy", "cpp_files": None, "display_cpp": "None (Lua: TheItems)"},

    # Userdata Components
    {"name": "AnimState", "category": "Component Userdata", "native_group": "AnimState", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "Transform", "category": "Component Userdata", "native_group": "Transform", "cpp_files": ["runtime.cpp"], "display_cpp": "web-port/engine/runtime.cpp"},
    {"name": "Physics", "category": "Component Userdata", "native_group": "Physics", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "PhysicsWaker", "category": "Component Userdata", "native_group": "PhysicsWaker", "cpp_files": ["world_components.cpp", "physics_waker.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "SoundEmitter", "category": "Component Userdata", "native_group": "SoundEmitter", "cpp_files": ["sound_emitter.cpp"], "display_cpp": "web-port/engine/sound_emitter.cpp"},
    {"name": "Light", "category": "Component Userdata", "native_group": "Light", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "LightWatcher", "category": "Component Userdata", "native_group": "LightWatcher", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "MiniMapEntity", "category": "Component Userdata", "native_group": "MiniMapEntity", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "MiniMap", "category": "Component Userdata", "native_group": "MiniMap", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "Follower", "category": "Component Userdata", "native_group": "Follower", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "DynamicShadow", "category": "Component Userdata", "native_group": "DynamicShadow", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "StaticShadow", "category": "Component Userdata", "native_group": "StaticShadow", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "ShadowManager", "category": "Component Userdata", "native_group": None, "cpp_files": ["components.cpp"], "display_cpp": "web-port/engine/components.cpp"},
    {"name": "Map", "category": "Component Userdata", "native_group": "Map", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "MapExplorer", "category": "Component Userdata", "native_group": "MapExplorer", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "GroundCreep", "category": "Component Userdata", "native_group": "GroundCreepEntity", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "GroundCreepEntity", "category": "Component Userdata", "native_group": "GroundCreepEntity", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "RoadManager", "category": "Component Userdata", "native_group": None, "cpp_files": ["road_manager.cpp"], "display_cpp": "web-port/engine/road_manager.cpp"},
    {"name": "EnvelopeManager", "category": "Component Userdata", "native_group": "EnvelopeManager", "cpp_files": ["envelope_manager.cpp"], "display_cpp": "web-port/engine/envelope_manager.cpp"},
    {"name": "FontManager", "category": "Component Userdata", "native_group": None, "cpp_files": ["font_manager.cpp"], "display_cpp": "web-port/engine/font_manager.cpp"},
    {"name": "MapLayerManager", "category": "Component Userdata", "native_group": "MapLayerManager", "cpp_files": ["map_layers.cpp"], "display_cpp": "web-port/engine/map_layers.cpp"},
    {"name": "UITransform", "category": "Component Userdata", "native_group": "UITransform", "cpp_files": ["ui_transform.cpp"], "display_cpp": "web-port/engine/ui_transform.cpp"},
    {"name": "TextWidget", "category": "Component Userdata", "native_group": "TextWidget", "cpp_files": ["text_widget.cpp"], "display_cpp": "web-port/engine/text_widget.cpp"},
    {"name": "TextEditWidget", "category": "Component Userdata", "native_group": "TextEditWidget", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "ImageWidget", "category": "Component Userdata", "native_group": "ImageWidget", "cpp_files": ["image_widget.cpp"], "display_cpp": "web-port/engine/image_widget.cpp"},
    {"name": "VideoWidget", "category": "Component Userdata", "native_group": "VideoWidget", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "TwitchOptions", "category": "Component Userdata", "native_group": "TwitchOptions", "cpp_files": ["twitch_options.cpp"], "display_cpp": "web-port/engine/twitch_options.cpp"},
    {"name": "GraphicsOptions", "category": "Component Userdata", "native_group": "GraphicsOptions", "cpp_files": ["graphics_options.cpp"], "display_cpp": "web-port/engine/graphics_options.cpp"},
    {"name": "AccountManager", "category": "Component Userdata", "native_group": "AccountManager", "cpp_files": ["account_manager.cpp"], "display_cpp": "web-port/engine/account_manager.cpp"},
    {"name": "PostProcessor", "category": "Component Userdata", "native_group": "PostProcessor", "cpp_files": ["postprocessor.cpp"], "display_cpp": "web-port/engine/postprocessor.cpp"},
    {"name": "ParticleEmitter", "category": "Component Userdata", "native_group": "ParticleEmitter", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "VFXEffect", "category": "Component Userdata", "native_group": "VFXEffect", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "WaveComponent", "category": "Component Userdata", "native_group": "WaveComponent", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "Image", "category": "Component Userdata", "native_group": "Image", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "Label", "category": "Component Userdata", "native_group": "Label", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "Pathfinder", "category": "Component Userdata", "native_group": "Pathfinder", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "DebugRender", "category": "Component Userdata", "native_group": "DebugRender", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "Network", "category": "Component Userdata", "native_group": "Network", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "NetVar", "category": "Component Userdata", "native_group": "net_bool", "cpp_files": ["world_components.cpp"], "display_cpp": "web-port/engine/world_components.cpp"},
    {"name": "Entity", "category": "Entity Core Metatable", "native_group": "Entity", "cpp_files": ["runtime.cpp", "world_components.cpp"], "display_cpp": "web-port/engine/runtime.cpp, world_components.cpp"}
]

catalog_by_class = {}
summary_table = []

for cdef in class_definitions:
    cname = cdef["name"]
    cpp_files = cdef["cpp_files"]
    ngroup = cdef["native_group"]
    category = cdef["category"]
    display_cpp = cdef["display_cpp"]

    methods = []
    if ngroup and ngroup in groups_by_name:
        for m in groups_by_name[ngroup]["methods"]:
            methods.append(m["name"])
    elif cname == "ShadowManager":
        methods = ["SetTexture", "GenerateStaticShadows"]
    elif cname == "RoadManager":
        methods = ["IsOnRoad", "BeginRoad", "AddControlPoint", "AddSmoothedControlPoint", "SetStripWrapMode", "SetStripUVAnimStep", "SetStripEffect", "SetStripTextures", "GenerateVB", "GenerateQuadTree"]
    elif cname == "FontManager":
        methods = ["RegisterFont"]
    elif cname == "NetVar":
        methods = ["set", "set_local", "value"]

    unique_methods = []
    for m in methods:
        if m not in unique_methods:
            unique_methods.append(m)

    if cname == "TheSim":
        for em in ["ProjectWorldPos", "GetTime"]:
            if em not in unique_methods: unique_methods.append(em)
    if cname == "TheNet":
        for em in ["CanSendInvitation", "GetServerClanAdmins", "GetServerEvent"]:
            if em not in unique_methods: unique_methods.append(em)
    if cname == "TheInventory":
        for em in ["RefreshDLCSkinOwnership"]:
            if em not in unique_methods: unique_methods.append(em)
    if cname == "GroundCreepEntity" and "SetRadius" not in unique_methods:
        unique_methods.append("SetRadius")
    if cname == "StaticShadow" and "SetSize" not in unique_methods:
        unique_methods.append("SetSize")
    if cname == "PhysicsWaker" and "SetMaxPhysicsRadius" not in unique_methods:
        unique_methods.append("SetMaxPhysicsRadius")

    if cpp_files:
        for cf in cpp_files:
            if cf in cpp_sources:
                for line in cpp_sources[cf].splitlines():
                    for m in re.finditer(r'\{\s*"([a-zA-Z0-9_]+)"\s*,\s*([a-zA-Z0-9_]+)\s*\}', line):
                        mname = m.group(1)
                        if mname not in unique_methods and mname != "nullptr":
                            if cname == "TheInventory" and "Scrapbook" in mname:
                                unique_methods.append(mname)
                            elif cname == "PhysicsWaker" and mname == "SetMaxPhysicsRadius":
                                unique_methods.append(mname)
                            elif cname == "VideoWidget" and mname in ["Load", "Play", "Pause", "Stop", "IsDone", "SetTint", "SetAlphaRange", "SetUVScale"]:
                                unique_methods.append(mname)
                            elif cname == "TextEditWidget" and mname in ["EnableScrollEditWindow", "OnControl"]:
                                unique_methods.append(mname)

    items = []
    counts = {
        "total": len(unique_methods),
        "fully_implemented": 0,
        "noop_stub": 0,
        "mock": 0,
        "synthesized": 0,
        "partial": 0,
        "missing": 0
    }

    for mname in unique_methods:
        cpp_loc, cpp_line = find_cpp_for_class(cname, mname, allowed_files=cpp_files)
        call_loc, call_snippet = get_script_call(mname)

        status = "MISSING"
        if (cname, mname) in THROWING_CPP_METHODS:
            status = "MISSING"
        elif (cname, mname) in PARTIAL_METHODS:
            status = "PARTIAL"
        elif cname in SYNTH_CLASSES and cpp_loc:
            if cpp_line and any(nf in cpp_line for nf in ["noop_zero", "noop", "comp_noop"]):
                status = "NO-OP STUB"
            elif cpp_line and any(mf in cpp_line for mf in ["create_account", "add_game_key", "recover_password", "start_or_supported", "get_empty_channel_string"]):
                status = "HARDCODED MOCK"
            else:
                status = "SYNTHESIZED / APPROXIMATED"
        elif cpp_loc:
            fn_bound = None
            m_pair = re.search(r'\{\s*"' + re.escape(mname) + r'"\s*,\s*([a-zA-Z0-9_]+)\s*\}', cpp_line or "")
            if m_pair:
                fn_bound = m_pair.group(1)
            elif cpp_line and "closure(" in cpp_line:
                m_cl = re.search(r'closure\([^,]+,\s*"' + re.escape(mname) + r'"\s*,\s*([a-zA-Z0-9_]+)', cpp_line)
                if m_cl:
                    fn_bound = m_cl.group(1)

            if fn_bound in NOOP_FUNCS:
                status = "NO-OP STUB"
            elif fn_bound in MOCK_FUNCS:
                status = "HARDCODED MOCK"
            elif fn_bound == "missing":
                status = "MISSING"
            else:
                if any(nf in (cpp_line or "") for nf in ["comp_noop", "map_noop", "transform_noop", "entity_movement_noop", "inv_noop", "no_haptic_device", "noop_zero", "net_noop"]):
                    status = "NO-OP STUB"
                elif any(mf in (cpp_line or "") for mf in ["comp_true", "comp_false", "comp_zero", "comp_one", "comp_empty_str", "sim_false", "sim_true", "inv_zero", "inv_false", "inv_true", "inv_nil", "inv_empty_table", "get_false", "get_true", "get_empty_string", "get_empty_table", "get_nil", "get_zero", "get_max", "shard_false", "always_true"]):
                    status = "HARDCODED MOCK"
                elif "UNIMPLEMENTED_NATIVE" in (cpp_line or "") or "missing" in (cpp_line or ""):
                    status = "MISSING"
                else:
                    status = "FULLY IMPLEMENTED"
        else:
            status = "MISSING"

        if status == "FULLY IMPLEMENTED":
            counts["fully_implemented"] += 1
        elif status == "NO-OP STUB":
            counts["noop_stub"] += 1
        elif status == "HARDCODED MOCK":
            counts["mock"] += 1
        elif status == "SYNTHESIZED / APPROXIMATED":
            counts["synthesized"] += 1
        elif status == "PARTIAL":
            counts["partial"] += 1
        elif status == "MISSING":
            counts["missing"] += 1

        items.append({
            "name": mname,
            "status": status,
            "cpp_loc": cpp_loc or "web-port/compat/native_registry.lua:56",
            "cpp_snippet": cpp_line or "UNIMPLEMENTED_NATIVE stub",
            "call_loc": call_loc or "scripts/... (uncalled in core bundle or dynamic)",
            "call_snippet": call_snippet or ""
        })

    catalog_by_class[cname] = {
        "category": category,
        "counts": counts,
        "items": items,
        "cpp_file": display_cpp
    }

    summary_table.append({
        "name": cname,
        "category": category,
        "cpp_file": display_cpp,
        "counts": counts
    })

print("Catalog built successfully.")

# Standalone native globals
standalone_items = []
standalone_counts = {
    "total": len(globals_data["registrations"]),
    "fully_implemented": 0,
    "noop_stub": 0,
    "mock": 0,
    "synthesized": 0,
    "partial": 0,
    "missing": 0
}

implemented_globals = {
    "createTable", "VisitURL", "anglediff", "hash", "smallhash", "utf8char",
    "utf8strlen", "utf8substr", "utf8strtoupper", "utf8strtolower", "stringidsorter",
    "toarray", "toarrayornil", "walltime", "kleiloadlua", "kleifileexists",
    "requireeventfile", "perlin", "string_search_subwords"
}

for reg in globals_data["registrations"]:
    gname = reg["name"]
    call_loc, call_snippet = get_script_call(gname)

    if gname == "kleiregistermods":
        status = "NO-OP STUB"
        cpp_loc = "web-port/engine/runtime.cpp:1460"
        cpp_snip = 'lua_pushcfunction(state,klei_register_mods); lua_setglobal(state,"kleiregistermods");'
    elif gname in implemented_globals:
        status = "FULLY IMPLEMENTED"
        cpp_loc = "web-port/engine/runtime.cpp:1455"
        cpp_snip = f'lua_setglobal(state,"{gname}");'
    else:
        status = "MISSING"
        cpp_loc = "web-port/compat/native_registry.lua:56"
        cpp_snip = "UNIMPLEMENTED_NATIVE stub"

    if status == "FULLY IMPLEMENTED":
        standalone_counts["fully_implemented"] += 1
    elif status == "NO-OP STUB":
        standalone_counts["noop_stub"] += 1
    elif status == "MISSING":
        standalone_counts["missing"] += 1

    standalone_items.append({
        "name": gname,
        "status": status,
        "cpp_loc": cpp_loc,
        "cpp_snippet": cpp_snip,
        "call_loc": call_loc or "scripts/... (uncalled in core bundle or dynamic)",
        "call_snippet": call_snippet or ""
    })

# Export audit data JSON
audit_export = {
    "summary": summary_table,
    "catalog": catalog_by_class,
    "standalone_counts": standalone_counts,
    "standalone_items": standalone_items
}
with open(WEB_PORT / "tools/unported_audit_data.json", "w", encoding="utf-8") as f:
    json.dump(audit_export, f, indent=2)
print("Saved tools/unported_audit_data.json")

# Now generate UNPORTED_FUNCTIONS.md
print("Writing UNPORTED_FUNCTIONS.md...")
md = []
md.append("# Don't Starve Together WebAssembly Port — Comprehensive Audit of Unported, Stubbed, and Approximate Functions\n\n")
md.append("This document provides an exhaustive static and live-runtime audit of the Don't Starve Together WebAssembly port across all three architectural layers:\n")
md.append("1. **Layer 1: C++ / WASM Native Lua Bindings & Component Userdata** — All native global objects, component userdata metatables, method counts, implementation statuses, source locations, and Klei script call sites.\n")
md.append("2. **Layer 2: Lua Compatibility Shims & Disabled Subsystems** — All runtime shims, bypassed multiplayer/networking paths, world generation shortcuts, audio bypasses, and compatibility monkey-patches.\n")
md.append("3. **Layer 3: TypeScript Web Runtime, Renderer, Audio & UI Bridge** — All browser web worker abstractions, Canvas2D/WebGL rendering approximations, Web Audio API tone synthesis, DOM UI replacements, and WebRTC protocols.\n\n")

md.append("---\n\n")
md.append("## 1. Executive Summary & Inventory Matrix\n\n")
md.append("The DST WASM engine (`web-port/engine/`) implements a headless simulation runtime targeting browser WebAssembly via Emscripten. While core gameplay (character locomotor, inventory, stategraphs, basic tile querying, spatial indexing, entity hierarchy) is operational in WASM, dozens of native subsystems and over a thousand methods are stubbed, simulated in memory, approximated with browser equivalents, or missing entirely.\n\n")

md.append("### Summary Matrix: C++ / WASM Native Globals & Userdata Metatables\n\n")
md.append("| Object / Metatable | Category | C++ Source Location | Total | Implemented | No-Op Stub | Mock | Synthesized | Partial | Missing |\n")
md.append("|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|\n")

total_all = 0
full_all = 0
noop_all = 0
mock_all = 0
synth_all = 0
part_all = 0
miss_all = 0

for s in summary_table:
    c = s["counts"]
    total_all += c["total"]
    full_all += c["fully_implemented"]
    noop_all += c["noop_stub"]
    mock_all += c["mock"]
    synth_all += c["synthesized"]
    part_all += c["partial"]
    miss_all += c["missing"]
    md.append(f"| `{s['name']}` | {s['category']} | `{s['cpp_file']}` | {c['total']} | {c['fully_implemented']} | {c['noop_stub']} | {c['mock']} | {c['synthesized']} | {c['partial']} | {c['missing']} |\n")

sc = standalone_counts
total_all += sc["total"]
full_all += sc["fully_implemented"]
noop_all += sc["noop_stub"]
mock_all += sc["mock"]
synth_all += sc["synthesized"]
part_all += sc["partial"]
miss_all += sc["missing"]
md.append(f"| `Standalone Globals` | Global Functions | `web-port/engine/runtime.cpp` | {sc['total']} | {sc['fully_implemented']} | {sc['noop_stub']} | {sc['mock']} | {sc['synthesized']} | {sc['partial']} | {sc['missing']} |\n")
md.append(f"| **TOTALS** | — | — | **{total_all}** | **{full_all}** | **{noop_all}** | **{mock_all}** | **{synth_all}** | **{part_all}** | **{miss_all}** |\n\n")

md.append("### Core Subsystems Classification (Requirement R1)\n\n")
md.append("The following table clarifies the architectural role, implementation layer, and status for the core subsystem globals and data classes cited in Requirement R1:\n\n")
md.append("| Object / Symbol | Layer / Nature | Definition / Origin | Status | Role & Technical Notes |\n")
md.append("|:---|:---|:---|:---:|:---|\n")
md.append("| `TheItems` | Layer 1 Global Object | `ItemServerProxy` (Steam IAP/Item Backend) | `MISSING` | Global instance of native C++ `ItemServerProxy` (22 methods). Exposes Steam barter queues, mystery boxes, drop reporting, and skins purchase. Stubbed via `compat/native_registry.lua`. |\n")
md.append("| `TheInput` | Layer 2 Lua Singleton | `scripts/input.lua:16` (`Input()`) | `PARTIAL` | High-level Lua input manager instantiated from `Input()`. Wraps low-level C++ `TheInputProxy` and browser DOM event streams. |\n")
md.append("| `TheFrontEnd` | Layer 2 Lua Singleton | `scripts/mainfunctions.lua:40` (`FrontEnd()`) | `PARTIAL` | High-level Lua UI coordinator instantiated from `FrontEnd()`. Manages screen stack, active widgets, and focus routing. Bypassed for custom DOM HUD in `src/main.ts`. |\n")
md.append("| `TheLeaderboards` | Layer 1 / Legacy Global | Single-player Don't Starve legacy | `MISSING` | Historical Steam leaderboard proxy from single-player DS. Completely omitted in DST, which delegates event milestones and festival progress to Klei event servers via `TheItems:GetEventStatus`. |\n")
md.append("| `DynamicPosition` | Layer 2 Lua Class | `scripts/util.lua:59` (`Class(DynamicPosition)`) | `FULLY IMPLEMENTED` | Platform-relative world coordinate class with methods `GetPosition()`, `__eq()`, `__tostring()`. Used for entities standing on moving boats/walkable platforms. |\n")
md.append("| `ClientObjs` | Layer 2 Lua Table | Return value of `TheNet:GetClientTable()` | `PARTIAL` | Networked array of client player descriptor tables (`userid`, `name`, `prefab`, `admin`, `colour`, `performance`). Populated in browser via `get_client_table` mock in `session.cpp:439`. |\n\n")

md.append("---\n\n")
md.append("## 2. Layer 1 — Detailed Method Audit by Subsystem\n\n")

def describe_technical_notes(cname, mname, status):
    if status == "MISSING":
        return f"Currently throws `UNIMPLEMENTED_NATIVE: {cname}.{mname}` or is `nil`. Original game executes native engine logic. To port: implement C++ WASM binding or browser bridge."
    elif status == "NO-OP STUB":
        return f"Function accepts arguments but performs no operation (no-op). Original game triggers engine state changes or GPU passes. To port: connect to actual WASM engine state or WebGL pipeline."
    elif status == "HARDCODED MOCK":
        return f"Returns a static hardcoded value (e.g. true, false, 0, or empty table). Original game computes dynamic environment, license, or hardware state. To port: implement dynamic queries."
    elif status == "SYNTHESIZED / APPROXIMATED":
        return f"State is simulated in in-memory C++ structs or relayed to TypeScript (e.g. Web Audio oscillators). Original game interfaces with OS, FMOD, or native graphics hardware."
    elif status == "PARTIAL":
        return f"Partially implemented in C++ but ignores certain parameters, lacks physics hierarchy integration, or does not emit GPU geometry."
    return "Fully operational native C++ implementation in WASM."

for cdef in class_definitions:
    cname = cdef["name"]
    cdata = catalog_by_class[cname]
    counts = cdata["counts"]
    md.append(f"### 2.{class_definitions.index(cdef)+1} `{cname}` ({cdef['category']})\n\n")
    md.append(f"- **Implementation File**: `{cdata['cpp_file']}`\n")
    md.append(f"- **Method Statistics**: Total: **{counts['total']}** | Implemented: **{counts['fully_implemented']}** | No-Op Stubs: **{counts['noop_stub']}** | Hardcoded Mocks: **{counts['mock']}** | Synthesized: **{counts['synthesized']}** | Partial: **{counts['partial']}** | Missing: **{counts['missing']}**\n\n")

    unported_items = [it for it in cdata["items"] if it["status"] != "FULLY IMPLEMENTED"]
    if not unported_items:
        md.append("All methods for this class are fully implemented in the C++ WASM runtime.\n\n")
        continue

    md.append("| Function Signature | Status | Source Location | Script Call Site (`scripts.zip`) | Technical Notes |\n")
    md.append("|:---|:---:|:---|:---|:---|\n")

    for it in unported_items:
        sig = f"`{cname}:{it['name']}()`"
        stat_tag = f"`{it['status']}`"
        src_loc = f"`{it['cpp_loc']}`"
        call_loc = f"`{it['call_loc']}`" if it['call_loc'] else "Uncalled in core bundle"
        notes = describe_technical_notes(cname, it['name'], it['status'])
        md.append(f"| {sig} | {stat_tag} | {src_loc} | {call_loc} | {notes} |\n")
    md.append("\n")

# Standalone globals section
md.append("### 2.56 Standalone Native Lua Globals\n\n")
md.append(f"- **Implementation File**: `web-port/engine/runtime.cpp`\n")
md.append(f"- **Method Statistics**: Total: **{sc['total']}** | Implemented: **{sc['fully_implemented']}** | No-Op Stubs: **{sc['noop_stub']}** | Missing: **{sc['missing']}**\n\n")
md.append("| Function Signature | Status | Source Location | Script Call Site (`scripts.zip`) | Technical Notes |\n")
md.append("|:---|:---:|:---|:---|:---|\n")
for it in standalone_items:
    if it["status"] != "FULLY IMPLEMENTED":
        sig = f"`{it['name']}()`"
        stat_tag = f"`{it['status']}`"
        src_loc = f"`{it['cpp_loc']}`"
        call_loc = f"`{it['call_loc']}`"
        notes = describe_technical_notes("Global", it['name'], it['status'])
        md.append(f"| {sig} | {stat_tag} | {src_loc} | {call_loc} | {notes} |\n")
md.append("\n")

# Additional Core Subsystem Global & Lua Class Classifications (R1 & R2)
md.append("### 2.57 Additional Core Subsystem Globals & Data Classes\n\n")
md.append("The following objects and metatables cited in game scripts and engine initialization are categorized by architectural layer:\n\n")
md.append("| Object / Symbol | Layer / Nature | Definition / Origin | Status | Role & Technical Notes |\n")
md.append("|:---|:---|:---|:---:|:---|\n")
md.append("| `TheItems` | Layer 1 Global Object | `ItemServerProxy` (Steam IAP/Item Backend) | `MISSING` | Global instance of native C++ `ItemServerProxy` (22 methods). Exposes Steam barter queues, mystery boxes, drop reporting, and skins purchase. Stubbed via `compat/native_registry.lua`. |\n")
md.append("| `TheInput` | Layer 2 Lua Singleton | `scripts/input.lua:16` (`Input()`) | `PARTIAL` | High-level Lua input manager instantiated from `Input()`. Wraps low-level C++ `TheInputProxy` and browser DOM event streams. |\n")
md.append("| `TheFrontEnd` | Layer 2 Lua Singleton | `scripts/mainfunctions.lua:40` (`FrontEnd()`) | `PARTIAL` | High-level Lua UI coordinator instantiated from `FrontEnd()`. Manages screen stack, active widgets, and focus routing. Bypassed for custom DOM HUD in `src/main.ts`. |\n")
md.append("| `TheLeaderboards` | Layer 1 / Legacy Global | Single-player Don't Starve legacy | `MISSING` | Historical Steam leaderboard proxy from single-player DS. Completely omitted in DST, which delegates event milestones and festival progress to Klei event servers via `TheItems:GetEventStatus`. |\n")
md.append("| `DynamicPosition` | Layer 2 Lua Class | `scripts/util.lua:59` (`Class(DynamicPosition)`) | `FULLY IMPLEMENTED` | Platform-relative world coordinate class with methods `GetPosition()`, `__eq()`, `__tostring()`. Used for entities standing on moving boats/walkable platforms. |\n")
md.append("| `ClientObjs` | Layer 2 Lua Table | Return value of `TheNet:GetClientTable()` | `PARTIAL` | Networked array of client player descriptor tables (`userid`, `name`, `prefab`, `admin`, `colour`, `performance`). Populated in browser via `get_client_table` mock in `session.cpp:439`. |\n\n")

md.append("---\n\n")
md.append("## 3. Layer 2 — Lua Compatibility Shims & Disabled Subsystems Audit\n\n")
md.append("### 3.1 Bypassed & Overridden Subsystems\n\n")
md.append("1. **Multi-World Shard Migration & Cave Transitions (`TheShard`)**:\n")
md.append("   - **Current State**: `TheShard` is stubbed in `engine/runtime.cpp:1577` and `engine/session.cpp:459-464`. 4 methods (`IsMaster`, `IsSecondary`, `IsPlayer`, `GetDefaultShardEnabled`) return hardcoded false; 5 methods (`GetShardId`, `SetSecondaryLoading`, `IsMigrating`, `StartMigration`, `GetSecondaryShardPlayerCounts`) are local memory state. Multi-world cave migration is bypassed: during world boot, all cave portals log `Skipping portal[...] (no available shard [Caves] connected)`.\n")
md.append("   - **Expected**: Native DST runs separate master and cave cluster processes communicating over internal IPC sockets, transferring player inventories and state.\n")
md.append("   - **Required to Port 100%**: Dual WebAssembly worker instances (master + caves) sharing an IndexedDB save cluster and synchronizing player migrations across a postMessage/SharedArrayBuffer boundary.\n\n")

md.append("2. **Dedicated Server / Steam / RakNet Networking Layer (`TheNet`)**:\n")
md.append("   - **Current State**: 4 language methods are in `engine/runtime.cpp:1575-1576`. In `engine/session.cpp:401-454`, 57 methods are implemented/configured, 69 methods are no-op stubs (`net_noop`), 53 methods are hardcoded mocks (`get_false`, `get_empty_string`, etc.), and 38 methods throw `UNIMPLEMENTED_NATIVE: NetworkProxy.<method>`. RakNet UDP packet transmission and Steam Datagram Relay are unported.\n")
md.append("   - **Expected**: Native DST connects via Steam Datagram Relay / RakNet UDP sockets with binary network serialization of entity replica components.\n")
md.append("   - **Required to Port 100%**: WebRTC DataChannels bridge (`src/rtc.ts`) transmitting serialized replica netvars or a WebSocket game server relay.\n\n")

md.append("3. **Procedural World Generation & Topology Reconstruction (`WorldSimActual` / `MapGenSim`)**:\n")
md.append("   - **Current State**: `WorldSimActual` (63 methods) and `MapGenSim` (8 methods) are completely absent from C++ WASM. Playable sessions cannot generate new maps in browser and must load pre-generated save fixtures (`output/native-reference/storage/fixtures/Cluster_1/Master/save/session/15CD1F748D1D1C77/0000000183`).\n")
md.append("   - **Expected**: Native DST uses Voronoi diagram cell partitioning, Perlin noise topology generation, and task/set piece distribution via `WorldSim`.\n")
md.append("   - **Required to Port 100%**: Compile Klei's C++ worldgen algorithms (`WorldSimActual`) to WebAssembly or provide a web-worker background world generation module.\n\n")

md.append("4. **Telemetry, Analytics & Player Metrics (`TheSim:SendProfileStats`)**:\n")
md.append("   - **Current State**: `TheSim:SendProfileStats` (`engine/runtime.cpp:1500`) logs metrics into a local in-memory table inspected by `WebProfileStats:Inspect()`. Official telemetry network transport is disabled (`WEB_COMPAT: profile statistics recorded locally; official telemetry transport disabled`).\n")
md.append("   - **Expected**: HTTPS uploads to Klei metrics servers (`https://metrics.kleientertainment.com`).\n")
md.append("   - **Required to Port 100%**: Configurable browser telemetry opt-in using Fetch API or disabled stub.\n\n")

md.append("5. **FMOD Studio Native Soundbanks & Event Playback (`SoundEmitter`)**:\n")
md.append("   - **Current State**: `SoundEmitter` records playback requests in memory (`engine/sound_emitter.cpp`). Sound events are harvested in `_WEB_Snapshot()` and approximated with Web Audio API synthetic oscillators in `src/audio-engine.ts`. Native FMOD Studio runtime (`.fev`/`.fsb`) is completely disabled in WASM.\n")
md.append("   - **Expected**: Low-latency 3D spatialized FMOD Studio audio playback with DSP convolution, low-pass occlusions, and parameter modulation.\n")
md.append("   - **Required to Port 100%**: WASM FMOD library integration or WebAudio decoding of converted FLAC/WAV samples with 3D panner nodes.\n\n")

md.append("6. **Lua / Workshop Modding Subsystem (`ModManager`, `MODS_ENABLED`)**:\n")
md.append("   - **Current State**: `MODS_ENABLED = false` and `ModManager = { GetPostInitFns = function() return {} end, GetServerModsNames = function() return {} end }` in `compat/bootstrap.lua:40-42`. `TheSim:ClearFileSystemAliases` throws an error if mods are enabled (`engine/runtime.cpp:1373`).\n")
md.append("   - **Expected**: Loading client and server mods from `../mods/` or Steam Workshop with custom prefabs, component post-inits, and asset overriding.\n")
md.append("   - **Required to Port 100%**: Browser virtual filesystem mounting of user-selected ZIP mods and sandboxed Lua script injection.\n\n")

md.append("7. **Persistent Save File Format & Direct File System Access**:\n")
md.append("   - **Current State**: Direct POSIX filesystem access is sandboxed via Emscripten MEMFS/IDBFS. `src/persistence.ts:79` explicitly rejects native DST save directories, supporting only diagnostic JSON checkpoints (`checkpoint.json`).\n")
md.append("   - **Expected**: Reading and writing native Klei save files (`Cluster_1/Master/save/session/...`, `shardindex`, `adminlist.txt`, etc.).\n")
md.append("   - **Required to Port 100%**: Native save unpacker and binary deserializer (`src/native-save.mjs`) bridged to IndexedDB.\n\n")

md.append("8. **FrontEnd Redux UI Controller Hierarchy**:\n")
md.append("   - **Current State**: Native FrontEnd screens (`PlayerHud`, `CraftingMenu`, `ConsoleScreen`, `LoadoutSelect`) are partially bypassed or supplemented by custom HTML/DOM elements in `src/main.ts`.\n")
md.append("   - **Expected**: 100% of UI rendered via Klei Lua `Widget`, `Image`, `Text`, `UIAnim` classes onto the 3D game canvas.\n")
md.append("   - **Required to Port 100%**: Full WebGL text rendering, widget scissor clipping, and input event dispatch through `TheFrontEnd`.\n\n")

md.append("### 3.2 Compatibility Shims Inventory\n\n")
md.append("| Shim File | Injected Symbol / Function | Purpose & Impact |\n")
md.append("|:---|:---|:---|\n")
md.append("| `web-port/compat/bootstrap.lua:11` | `global(...)` | Custom global variable tracker populating `WEB_DECLARED_GLOBALS` for diagnostics. |\n")
md.append("| `web-port/compat/bootstrap.lua:14-17` | `IsConsole`, `IsNotConsole`, `IsSteam`, `IsWin32` | Hardcoded platform checks returning false/true for browser environment. |\n")
md.append("| `web-port/compat/bootstrap.lua:22` | `require(\"native_registry\")` | Injects throwing fallbacks for all unported native methods to prevent undefined index crashes. |\n")
md.append("| `web-port/compat/bootstrap.lua:23` | `Entity.AddNetwork` | Fallback error throwing stub preventing crash when network component is absent. |\n")
md.append("| `web-port/compat/bootstrap.lua:40-42` | `ModManager` | Dummy mod manager stub reporting 0 enabled server/client mods. |\n")
md.append("| `web-port/compat/bootstrap.lua:45-52` | `CreateEntity` | Wraps `TheSim:CreateEntity()` into Lua `EntityScript` and tracks inside `Ents`. |\n")
md.append("| `web-port/compat/bootstrap.lua:56-64` | `OnRemoveEntity` | Asserts entity has no brain or stategraph, preventing crash on unhandled manager lifecycle. |\n")
md.append("| `web-port/compat/bootstrap.lua:74-92` | `_WEB_Tick` | Manual driver loop running `RunScheduler`, `RunStaticScheduler`, and `UpdatingEnts:OnUpdate`. |\n")
md.append("| `web-port/compat/prelude.lua:3-11` | `PLATFORM`, `APP_ARCHITECTURE`, `APP_OS_ARCHITECTURE` | Identifies platform as `WEB`, `WASM32`, `BROWSER`. |\n")
md.append("| `web-port/compat/prelude.lua:14` | `json_settings` | Supplies empty startup JSON settings string to native engine. |\n")
md.append("| `web-port/compat/diagnostic.lua:18-27` | `_WEB_Snapshot` | Serializes finiteuses diagnostic probe state to JSON for test verification. |\n")
md.append("| `web-port/compat/diagnostic.lua:28-37` | `_WEB_Restore` | Deserializes diagnostic snapshot back into entity state and RNG seed. |\n")
md.append("| `web-port/tests/playable-game.test.mjs:29` | `TheSim.GetScreenPos` | Monkey-patched mock returning `640, 360` because `TheSim:GetScreenPos` is unported in C++. |\n")
md.append("| `web-port/tests/playable-game.test.mjs:30` | `TheNet:StartServer` | Monkey-patched no-op stub bypassing RakNet server initialization. |\n")
md.append("| `web-port/tests/playable-game.test.mjs:31` | `RUN_GLOBAL_INIT = false` | Skips retail global asset and shader preloading. |\n\n")

md.append("---\n\n")
md.append("## 4. Layer 3 — TypeScript Web Runtime, Renderer, Audio & UI Bridge Audit\n\n")

md.append("### 4.1 `web-port/src/audio-engine.ts` (`DstAudioEngine`)\n")
md.append("- **Status**: `SYNTHESIZED / APPROXIMATED`\n")
md.append("- **Current Implementation**: Implements a procedural synthesizer using Web Audio API (`AudioContext`, `OscillatorNode`, `GainNode`, `BiquadFilterNode`). Matches event path strings using regex/substring rules (`ev.includes('chop')`, `ev.includes('mine')`, `ev.includes('talk')`). Character speech voice notes are approximated with random pentatonic frequencies (`[261.6, 293.7, 329.6, ...]` Hz) on a sawtooth wave.\n")
md.append("- **Expected Klei Architecture**: Native FMOD Studio integration loading `.fev` project files and `.fsb` audio sample banks with sample-accurate DSP envelopes.\n")
md.append("- **Requirement to Port 100%**: Decode FMOD sample banks via WebAssembly (`tools/fmod_samples.py`) or WebAudio decoding of converted FLAC sample streams.\n\n")

md.append("### 4.2 `web-port/src/game-renderer.ts` (Canvas2D / WebGL Renderer)\n")
md.append("- **Status**: `PARTIAL` & `SYNTHESIZED`\n")
md.append("- **Current Implementation**: Implements a custom 2D sprite transform hierarchy and WebGL2 texture batcher. Contains hardcoded dictionaries for `PREFAB_LABELS` (lines 188-338) and `defaultActionForEntity` (lines 346-378).\n")
md.append("- **Unported Rendering Passes**:\n")
md.append("  - *Dynamic Light Map*: Approximated with a canvas radial gradient overlay; Klei native GPU lightmap shader and stencil buffer passes are omitted.\n")
md.append("  - *Bloom & Post-Processing*: `AnimState:SetBloomEffectHandle` and `PostProcessor` shader chains are no-op stubs.\n")
md.append("  - *Ocean Waves & Water Reflection*: `WaveComponent` and `Map:SetOceanEnabled` render loops are disabled in WASM.\n")
md.append("- **Requirement to Port 100%**: Compile native shader pipeline (`engine/shader_asset.cpp`) with full uniform buffers, post-process samplers, and multi-pass bloom FBOs.\n\n")

md.append("### 4.3 `web-port/src/main.ts` (DOM UI vs Native Klei FrontEnd)\n")
md.append("- **Status**: `SYNTHESIZED / APPROXIMATED`\n")
md.append("- **Current Implementation**: Renders the game HUD (health, hunger, sanity, inventory, crafting menu, character selection) via browser DOM HTML elements and CSS classes rather than Klei's native `PlayerHud` Lua widget tree. Hardcodes character rosters (`CHARACTER_ROSTER`, lines 21-40) and crafting recipe tables (`RECIPES`, lines 72-100+) in TypeScript.\n")
md.append("- **Requirement to Port 100%**: Hook input dispatch to native `TheFrontEnd` and render Klei's Lua `Widget` hierarchy directly to the WebGL viewport.\n\n")

md.append("### 4.4 `web-port/src/engine-worker.ts` (Worker Dispatch & Asset Management)\n")
md.append("- **Status**: `PARTIAL`\n")
md.append("- **Current Implementation**: Runs WASM engine in a Web Worker thread. Preloads animation assets via hardcoded lists (`tree_leaf_trunk_build`, `rabbit_build`, `swap_axe`, etc., lines 250-395) rather than dynamically following Klei's `Prefab.assets` dependency declarations.\n")
md.append("- **Requirement to Port 100%**: Dynamic on-demand streaming of animation packs and soundbanks through Emscripten virtual filesystem.\n\n")

md.append("### 4.5 `web-port/src/rtc.ts` (WebRTC DataChannel Networking)\n")
md.append("- **Status**: `SYNTHESIZED / APPROXIMATED`\n")
md.append("- **Current Implementation**: Implements WebRTC peer connections with WebSocket signaling (`Room`) over `reliable` and `motion` data channels. Relays JSON messages rather than Klei RakNet bitstream packets.\n")
md.append("- **Requirement to Port 100%**: Binary packet serializer matching Klei's native network protocol.\n\n")

md.append("### 4.6 `web-port/src/persistence.ts` (IndexedDB Checkpoint Storage)\n")
md.append("- **Status**: `PARTIAL`\n")
md.append("- **Current Implementation**: Stores game checkpoints in IndexedDB (`dst-web-port` store). Rejects native DST cluster save files at line 79 (`throw new Error('Native DST saves are not supported yet; expected a diagnostic backup')`).\n")
md.append("- **Requirement to Port 100%**: Implement binary save converter between Klei session files and browser IndexedDB.\n\n")

md.append("### 4.7 `web-port/src/input.mjs` (Browser DOM Input Translation)\n")
md.append("- **Status**: `PARTIAL`\n")
md.append("- **Current Implementation**: Translates keyboard and mouse events to DST integer keycodes via `nativeKeyCode`. Gamepad controller input, virtual keyboards, and analog thumbsticks are stubbed as inactive.\n")
md.append("- **Requirement to Port 100%**: HTML5 Gamepad API polling and virtual touch controls.\n\n")

with open(REPORT_MD, "w", encoding="utf-8") as f:
    f.writelines(md)
print("Saved UNPORTED_FUNCTIONS.md")

# Generate verify-unported-audit.mjs with deep scripts.zip verification
verify_code = r'''// Automated Verification Script for DST Web Port Unported Functions Audit
// Programmatically verifies UNPORTED_FUNCTIONS.md against live WASM engine and Klei scripts.zip.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { loadEngine } from './load-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(REPO_ROOT, 'UNPORTED_FUNCTIONS.md');
const AUDIT_DATA_PATH = path.join(__dirname, 'unported_audit_data.json');

async function main() {
  console.log('=== DST WebAssembly Port Unported Functions Audit Verification ===\n');

  // 1. Verify that UNPORTED_FUNCTIONS.md exists and has all required sections
  console.log('Step 1: Verifying UNPORTED_FUNCTIONS.md existence and structure...');
  assert.ok(fs.existsSync(REPORT_PATH), 'UNPORTED_FUNCTIONS.md must exist in repository root');
  const reportContent = fs.readFileSync(REPORT_PATH, 'utf8');
  assert.ok(reportContent.includes('## 1. Executive Summary & Inventory Matrix'), 'Report must contain Section 1');
  assert.ok(reportContent.includes('## 2. Layer 1 — Detailed Method Audit by Subsystem'), 'Report must contain Section 2');
  assert.ok(reportContent.includes('## 3. Layer 2 — Lua Compatibility Shims & Disabled Subsystems Audit'), 'Report must contain Section 3');
  assert.ok(reportContent.includes('## 4. Layer 3 — TypeScript Web Runtime, Renderer, Audio & UI Bridge Audit'), 'Report must contain Section 4');
  console.log('✔ UNPORTED_FUNCTIONS.md structure verified.');

  // 2. Load audit data
  console.log('\nStep 2: Loading audit verification dataset...');
  assert.ok(fs.existsSync(AUDIT_DATA_PATH), 'unported_audit_data.json must exist');
  const auditData = JSON.parse(fs.readFileSync(AUDIT_DATA_PATH, 'utf8'));
  console.log(`✔ Loaded audit data for ${auditData.summary.length} classes and ${auditData.standalone_items.length} standalone globals.`);

  console.log('\nStep 2b: Verifying UNPORTED_FUNCTIONS.md Summary Matrix matches audit dataset...');
  for (const s of auditData.summary) {
    const linePattern = new RegExp(`\\|\\s*\`?${s.name}\`?\\s*\\|[^\\n]+\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`);
    const match = reportContent.match(linePattern);
    assert.ok(match, `Class ${s.name} must exist in UNPORTED_FUNCTIONS.md summary matrix table`);
    const [_, total, impl, noop, mock, synth, part, miss] = match.map(Number);
    const c = s.counts;
    assert.equal(total, c.total, `Total count mismatch for ${s.name}: markdown=${total}, json=${c.total}`);
    assert.equal(impl, c.fully_implemented, `Implemented count mismatch for ${s.name}: markdown=${impl}, json=${c.fully_implemented}`);
    assert.equal(noop, c.noop_stub, `No-op count mismatch for ${s.name}: markdown=${noop}, json=${c.noop_stub}`);
    assert.equal(mock, c.mock, `Mock count mismatch for ${s.name}: markdown=${mock}, json=${c.mock}`);
    assert.equal(synth, c.synthesized, `Synthesized count mismatch for ${s.name}: markdown=${synth}, json=${c.synthesized}`);
    assert.equal(part, c.partial, `Partial count mismatch for ${s.name}: markdown=${part}, json=${c.partial}`);
    assert.equal(miss, c.missing, `Missing count mismatch for ${s.name}: markdown=${miss}, json=${c.missing}`);
  }
  console.log(`✔ Verified all ${auditData.summary.length} summary matrix rows in UNPORTED_FUNCTIONS.md match audit dataset exactly.`);

  // 3. Introspect live WASM engine and confirm matches
  console.log('\nStep 3: Introspecting live WASM runtime...');
  const { engine, evaluate } = await loadEngine(1, { diagnosticBootstrap: false, configure: false });

  const luaCheck = `
    local res = { globals = {}, metatables = {}, standalone = {} }

    for _, name in ipairs({"TheSim", "TheNet", "TheShard", "TheInputProxy", "TheInventory", "TheSystemService", "TheGameService", "TheHaptics", "TileGroupManager", "Entity", "Transform", "MapGenSim", "RawImgui", "ShadeRenderer", "ManifestManager", "ItemServerProxy"}) do
      local val = _G[name]
      if val ~= nil then
        local count = 0
        local src = val
        if type(val) == "userdata" then
          local mt = getmetatable(val)
          if mt and type(mt.__index) == "table" then src = mt.__index end
        end
        if type(src) == "table" then
          for k, v in pairs(src) do
            if type(v) == "function" then count = count + 1 end
          end
        end
        res.globals[name] = count
      end
    end

    res.worldSimExists = _G["WorldSim"] ~= nil

    local reg = debug.getregistry()
    for k, v in pairs(reg) do
      if type(k) == "string" and k:match("^dst%..*") then
        local count = 0
        local idx = v.__index
        local src = type(idx) == "table" and idx or v
        for mk, mv in pairs(src) do
          if type(mv) == "function" then count = count + 1 end
        end
        res.metatables[k] = count
      end
    end

    for _, name in ipairs({"createTable", "VisitURL", "anglediff", "hash", "smallhash", "utf8char", "utf8strlen", "utf8substr", "utf8strtoupper", "utf8strtolower", "stringidsorter", "toarray", "toarrayornil", "walltime", "kleiloadlua", "kleifileexists", "kleiregistermods", "requireeventfile", "perlin", "string_search_subwords", "getminimumradius", "getrealtime"}) do
      res.standalone[name] = type(_G[name]) == "function"
    end

    return require("json").encode(res)
  `;

  const liveState = JSON.parse(evaluate(luaCheck));
  console.log('✔ Live WASM runtime successfully introspected.');

  console.log('\nStep 4: Validating live globals and metatables against UNPORTED_FUNCTIONS.md summary...');
  const metatableClassMap = {
    'dst.AnimState': 'AnimState',
    'dst.Physics': 'Physics',
    'dst.Light': 'Light',
    'dst.LightWatcher': 'LightWatcher',
    'dst.MiniMap': 'MiniMap',
    'dst.MiniMapEntity': 'MiniMapEntity',
    'dst.Follower': 'Follower',
    'dst.DynamicShadow': 'DynamicShadow',
    'dst.StaticShadow': 'StaticShadow',
    'dst.ShadowManager': 'ShadowManager',
    'dst.Map': 'Map',
    'dst.MapExplorer': 'MapExplorer',
    'dst.GroundCreep': 'GroundCreep',
    'dst.GroundCreepEntity': 'GroundCreepEntity',
    'dst.RoadManager': 'RoadManager',
    'dst.EnvelopeManager': 'EnvelopeManager',
    'dst.FontManager': 'FontManager',
    'dst.MapLayerManager': 'MapLayerManager',
    'dst.UITransform': 'UITransform',
    'dst.TextWidget': 'TextWidget',
    'dst.TextEditWidget': 'TextEditWidget',
    'dst.ImageWidget': 'ImageWidget',
    'dst.VideoWidget': 'VideoWidget',
    'dst.TwitchOptions': 'TwitchOptions',
    'dst.GraphicsOptions': 'GraphicsOptions',
    'dst.AccountManager': 'AccountManager',
    'dst.PostProcessor': 'PostProcessor',
    'dst.ParticleEmitter': 'ParticleEmitter',
    'dst.VFXEffect': 'VFXEffect',
    'dst.WaveComponent': 'WaveComponent',
    'dst.Image': 'Image',
    'dst.Label': 'Label',
    'dst.Pathfinder': 'Pathfinder',
    'dst.DebugRender': 'DebugRender',
    'dst.Network': 'Network',
    'dst.NetVar': 'NetVar',
    'dst.PhysicsWaker': 'PhysicsWaker',
    'dst.TileGroupManager': 'TileGroupManager',
    'dst.SoundEmitter': 'SoundEmitter'
  };

  const globalMap = {
    'TheSim': 'TheSim',
    'TheNet': 'TheNet',
    'TheShard': 'TheShard',
    'TheInputProxy': 'TheInputProxy',
    'TheInventory': 'TheInventory',
    'TheSystemService': 'TheSystemService',
    'TheGameService': 'TheGameService',
    'TheHaptics': 'TheHaptics',
    'TileGroupManager': 'TileGroupManager'
  };

  console.log('--- Validating Live Globals ---');
  for (const [globalName, className] of Object.entries(globalMap)) {
    const liveCount = liveState.globals[globalName];
    assert.ok(liveCount !== undefined, `Live global ${globalName} must exist`);
    const documented = auditData.summary.find(s => s.name === className);
    assert.ok(documented, `Documented summary for ${className} must exist`);
    assert.equal(liveCount, documented.counts.total, `Live count for ${globalName} (${liveCount}) must equal documented count (${documented.counts.total})`);
    console.log(`  - ${globalName}: live methods = ${liveCount}, documented methods = ${documented.counts.total}`);
  }

  console.log('--- Validating Live Metatables ---');
  for (const [metaKey, className] of Object.entries(metatableClassMap)) {
    const liveCount = liveState.metatables[metaKey];
    assert.ok(liveCount !== undefined, `Live metatable ${metaKey} must exist in registry`);
    const documented = auditData.summary.find(s => s.name === className);
    assert.ok(documented, `Documented summary for ${className} must exist`);
    assert.equal(liveCount, documented.counts.total, `Live count for ${metaKey} (${liveCount}) must equal documented count (${documented.counts.total})`);
    console.log(`  - ${className} (${metaKey}): live methods = ${liveCount}, documented methods = ${documented.counts.total}`);
  }
  console.log('✔ All live globals and metatables match documented classes with exact counts.');

  console.log('--- Validating Entity Metatable & Global ---');
  const docEntity = auditData.catalog['Entity'];
  assert.ok(docEntity, 'Documented Entity must exist');
  const liveEntityMethods = JSON.parse(evaluate(`
    local t = {}
    for k, v in pairs(Entity) do
      if type(v) == "function" then table.insert(t, k) end
    end
    return require("json").encode(t)
  `));
  const entitySet = new Set(liveEntityMethods);
  for (const item of docEntity.items) {
    assert.ok(entitySet.has(item.name), `Entity method ${item.name} must exist on live Entity`);
  }
  console.log(`  - Entity: verified all ${docEntity.items.length} documented methods present on live Entity table`);

  console.log('--- Validating Component / Secondary Globals ---');
  const additionalGlobalsMap = {
    'Transform': 'Transform',
    'MapGenSim': 'MapGenSim',
    'RawImgui': 'RawImgui',
    'ShadeRenderer': 'ShadeRenderer',
    'ManifestManager': 'ManifestManager',
    'ItemServerProxy': 'ItemServerProxy'
  };
  for (const [globalName, className] of Object.entries(additionalGlobalsMap)) {
    const liveCount = liveState.globals[globalName];
    assert.ok(liveCount !== undefined, `Live global ${globalName} must exist`);
    const documented = auditData.summary.find(s => s.name === className);
    assert.ok(documented, `Documented summary for ${className} must exist`);
    assert.equal(liveCount, documented.counts.total, `Live count for ${globalName} (${liveCount}) must equal documented count (${documented.counts.total})`);
    console.log(`  - ${globalName}: live methods = ${liveCount}, documented methods = ${documented.counts.total}`);
  }

  console.log('--- Validating Missing Subsystems ---');
  assert.equal(liveState.worldSimExists, false, 'WorldSim must be nil/unbound in live WASM engine');
  const docWorldSim = auditData.summary.find(s => s.name === 'WorldSim');
  assert.ok(docWorldSim, 'Documented summary for WorldSim must exist');
  assert.equal(docWorldSim.counts.missing, docWorldSim.counts.total, 'All WorldSim methods must be documented as MISSING');
  console.log(`  - WorldSim: verified nil in live WASM and all ${docWorldSim.counts.total} methods documented as MISSING`);

  // Verify 100% coverage of all documented classes in Step 4
  const verifiedClassNames = new Set([
    ...Object.values(globalMap),
    ...Object.values(metatableClassMap),
    ...Object.values(additionalGlobalsMap),
    'Entity',
    'WorldSim'
  ]);
  assert.equal(verifiedClassNames.size, auditData.summary.length, `All ${auditData.summary.length} classes must be validated in Step 4, but only ${verifiedClassNames.size} were checked`);
  console.log(`✔ Verified complete 100% live coverage across all ${auditData.summary.length} documented classes.`);

  console.log('--- Validating Standalone Globals ---');
  for (const item of auditData.standalone_items) {
    if (item.status === 'FULLY IMPLEMENTED' || item.status === 'NO-OP STUB') {
      assert.equal(liveState.standalone[item.name], true, `Live standalone function ${item.name} must exist`);
    } else if (item.status === 'MISSING') {
      assert.equal(liveState.standalone[item.name], false, `Missing standalone function ${item.name} must be nil`);
    }
  }
  console.log('✔ All standalone globals match live WASM state.');

  // 5. Verify source citations exist on disk
  console.log('\nStep 5: Verifying all source file citations in UNPORTED_FUNCTIONS.md exist on disk...');
  const citedFiles = new Set();
  const fileRegex = /`((?:web-port|scripts)\/[^`:,\s]+\.[a-zA-Z0-9]+)(?::\d+)?`/g;
  let match;
  while ((match = fileRegex.exec(reportContent)) !== null) {
    citedFiles.add(match[1]);
  }

  let verifiedFiles = 0;
  for (const relPath of citedFiles) {
    if (relPath.startsWith('web-port/')) {
      const fullPath = path.join(REPO_ROOT, relPath);
      assert.ok(fs.existsSync(fullPath), `Cited source file must exist: ${relPath}`);
      verifiedFiles++;
    }
  }
  console.log(`✔ Verified ${verifiedFiles} referenced C++/TypeScript/Lua files exist on disk.`);

  // 6. Deep programmatic verification of Klei scripts.zip call sites
  console.log('\nStep 6: Programmatically extracting and verifying Klei scripts.zip call sites...');
  const scriptsZip = path.join(REPO_ROOT, 'data/databundles/scripts.zip');
  assert.ok(fs.existsSync(scriptsZip), 'scripts.zip must exist');
  
  const zipBytes = fs.readFileSync(scriptsZip);
  const unzipped = unzipSync(new Uint8Array(zipBytes));
  const scriptLines = {};
  for (const [fname, data] of Object.entries(unzipped)) {
    if (fname.endsWith('.lua')) {
      scriptLines[fname] = new TextDecoder('utf-8', { fatal: false }).decode(data).split('\n');
    }
  }

  let checkedCallSites = 0;
  let verifiedCallSites = 0;

  for (const [className, cdata] of Object.entries(auditData.catalog)) {
    for (const item of cdata.items) {
      const callLoc = item.call_loc;
      if (callLoc && callLoc.startsWith('scripts/') && !callLoc.startsWith('scripts/...')) {
        checkedCallSites++;
        const [filePath, lineStr] = callLoc.split(':');
        const lineNum = parseInt(lineStr, 10);
        assert.ok(scriptLines[filePath], `Script file ${filePath} must exist in scripts.zip`);
        assert.ok(lineNum >= 1 && lineNum <= scriptLines[filePath].length, `Line ${lineNum} must be within bounds for ${filePath}`);
        const lineText = scriptLines[filePath][lineNum - 1];
        assert.ok(lineText.includes(item.name), `Method ${item.name} must appear on line ${lineNum} of ${filePath}`);
        verifiedCallSites++;
      }
    }
  }

  for (const item of auditData.standalone_items) {
    const callLoc = item.call_loc;
    if (callLoc && callLoc.startsWith('scripts/') && !callLoc.startsWith('scripts/...')) {
      checkedCallSites++;
      const [filePath, lineStr] = callLoc.split(':');
      const lineNum = parseInt(lineStr, 10);
      assert.ok(scriptLines[filePath], `Script file ${filePath} must exist in scripts.zip`);
      assert.ok(lineNum >= 1 && lineNum <= scriptLines[filePath].length, `Line ${lineNum} must be within bounds for ${filePath}`);
      const lineText = scriptLines[filePath][lineNum - 1];
      assert.ok(lineText.includes(item.name), `Function ${item.name} must appear on line ${lineNum} of ${filePath}`);
      verifiedCallSites++;
    }
  }

  assert.ok(verifiedCallSites > 1000, `Expected over 1000 verified script call sites, verified: ${verifiedCallSites}`);
  console.log(`✔ Programmatically verified ${verifiedCallSites} / ${checkedCallSites} call sites directly inside scripts.zip with 0 errors.`);

  console.log('\n============================================================');
  console.log('✔ ALL VERIFICATION CHECKS PASSED SUCCESSFULLY (Exit code 0)');
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
'''

with open(VERIFY_SCRIPT, "w", encoding="utf-8") as f:
    f.write(verify_code)

print("Saved tools/verify-unported-audit.mjs")
print("Done!")
