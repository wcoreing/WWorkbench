import { useEffect, useRef } from 'react'
import { registerWorkbenchHandler, type WorkbenchCommand } from './workbenchCommandBus'

/** useWorkbenchCommand 注册工作台命令处理器（替代 useProductLink）。 */
export function useWorkbenchCommand(
  capability: string,
  onCmd: (cmd: WorkbenchCommand) => void | Promise<void>,
) {
  const handlerRef = useRef(onCmd)
  handlerRef.current = onCmd

  useEffect(() => {
    return registerWorkbenchHandler(capability, (cmd) => handlerRef.current(cmd))
  }, [capability])
}
