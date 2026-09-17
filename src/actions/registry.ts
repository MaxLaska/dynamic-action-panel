// Maps an action `type` string to its action class.
// Used by the factory and by type validation, so every supported action type is
// registered in exactly one place. A new action type only needs an entry here.
import { FileAction } from '@/actions/FileAction';
import { CommandAction } from '@/actions/CommandAction';
import { UrlAction } from '@/actions/UrlAction';
import { CreateFileAction } from '@/actions/CreateFileAction';
import { ScriptAction } from '@/actions/ScriptAction';

export const ACTION_TYPES = {
    file: FileAction,
    command: CommandAction,
    url: UrlAction,
    create_file: CreateFileAction,
    script: ScriptAction,
} as const;


