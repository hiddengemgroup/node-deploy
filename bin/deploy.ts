import { reflect } from '@riddance/host/reflect'
import { Resolver } from './lib/aws/resolve.js'
import { getCurrentState, sync } from './lib/aws/sync.js'
import { getGlue } from './lib/glue.js'
import { stage } from './lib/stage.js'
import { gzipSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [, , pathOrEnvArg, envArg, glueFile, ...args] = process.argv
if (!pathOrEnvArg) {
    throw new Error('Please specify target environment name')
}
const path = envArg ? pathOrEnvArg : process.cwd()
const envName = envArg ?? pathOrEnvArg

const options = parseOptions(args)

try {
    const resolver = new Resolver(envName)
    const { service, implementations, corsSites, env, ...provider } = await getGlue(
        path,
        envName,
        resolver,
        glueFile,
    )

    if (options.has('prepare-only')) {
        await writeFile(
            join(path, '.env'),
            makeEnvFilePayload(await env, options.has('compress')),
            'utf-8',
        )
        console.log('prepared .env')
    } else {
        const [currentState, reflection, code] = await Promise.all([
            getCurrentState(envName, service),
            reflect(path),
            stage(path, implementations, service),
        ])

        const host = await sync(
            envName,
            service,
            currentState,
            reflection,
            corsSites,
            await env,
            Object.fromEntries(code.map(c => [c.fn, c.code])),
            provider,
        )

        console.log('done.')

        console.log(`hosting on ${host}`)
    }
} catch (e) {
    const fileError = e as { code?: string; path?: string }
    if (fileError.code === 'ENOENT' && fileError.path?.endsWith('glue.json')) {
        console.error(
            "Glue not found. Try to see if there isn't a glue project you can clone next to this project.",
        )
        process.exit(1)
    }
    throw e
}

function parseOptions(params: string[]) {
    return ['compress', 'prepare-only', 'monitor'].reduce((map, key) => {
        if (params.includes(`--${key}`)) {
            map.set(key, true)
        }
        return map
    }, new Map<string, boolean>())
}

export function makeEnvFilePayload(variables: { [k: string]: string }, compress = false) {
    if (compress) {
        return `COMPRESSED_ENV=${gzipSync(JSON.stringify(variables), { level: 9 }).toString(
            'base64',
        )}`
    }
    return Object.entries(variables)
        .map(([name, value]) => {
            return `${name}=${value}`
        })
        .join('\n')
}
