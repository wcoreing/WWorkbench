export {}

declare global {
  interface Window {
    __wwBrowserStageVer?: number
    __wwBrowserStage?: boolean
    __wwBrowserStageHandler?: (
      msg: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (res: any) => void,
    ) => boolean
  }
}
