#!/bin/node
import { start } from 'repl'
import { createConnection } from 'net'
import { EventEmitter } from 'events'
import { readdir } from 'node:fs/promises'

const emitter = new EventEmitter()
let socket
let response = []

const sendCommand = (cmd, callback) => {
  socket.write(JSON.stringify(cmd))
  emitter.once('response', response => {
    callback(null, response)
  })
}

const connectSocket = id => {
  socket = createConnection(`/tmp/beval.socket.${id}`)
  socket.on('error', error => {
    if(error.code === 'ENOENT'){
      console.log(`Socket ${error.address} not found.`)
      console.log(`Beval native messaging host does not seem to be running.`)
    }else{
      console.log(error)
    }
  })

  socket.on('data', data => {
    response.push(data)
    if(data.toString().endsWith('\n')){
      emitter.emit('response', JSON.parse(response.join('')))
      response = []
    }
  })
}

const evalExtensionContext = (cmd, context, fileName, callback) => {
  sendCommand(cmd, callback)
}

const evalContentScriptContext = (cmd, context, fileName, callback) => {
  cmd = cmd.trim()
  cmd = cmd.replaceAll('`', '\\\`')
  const ctxCmd = `
  browser.tabs.executeScript(${context.tabId}, {
    code:\`${cmd}\`
  }).then(result=>result[0])
  `.trim()
  sendCommand(ctxCmd, callback)
}

const evalPageContext = (cmd, context, fileName, callback) => {
  cmd = cmd.trim()
  cmd = cmd.replaceAll('`', '\\\\\\`')
  const ctxCmd = `
  browser.tabs.executeScript(${context.tabId}, {
    code:\`window.eval(\\\`${cmd}\\\`)\`
  }).then(result=>result[0])
  `.trim()
  sendCommand(ctxCmd, callback)
}

const brepl = start({
  prompt: 'brepl:0> ',
  eval: evalExtensionContext
})

brepl.context.socketId = 0

brepl.on('exit', _ => {
  process.exit()
})

brepl.defineCommand('page', {
  help: 'Switch to page context of <tabId>',
  action(id) {
    id = id || this.context.tabId

    if(!id){
      return this.displayPrompt()
    }

    this.eval = evalPageContext
    this.context.tabId = id
    this.setPrompt(`brepl:${this.context.socketId}>${this.context.tabId}>page> `)
    this.displayPrompt()
  }
})

brepl.defineCommand('tab', {
  help: 'Switch to <tabId> context',
  action(id) {
    if(!id)
      return this.displayPrompt()

    this.eval = evalContentScriptContext
    this.context.tabId = id
    this.setPrompt(`brepl:${this.context.socketId}>${this.context.tabId}> `)
    this.displayPrompt()
  }
})

brepl.defineCommand('tabs', {
  help: 'list all tabs',
  action(){
    const cmd = 'browser.tabs.query({}).then(tabs=>tabs.map(tab=>`${tab.id} ${tab.title}`))'
    evalExtensionContext(cmd, null, null, (error, result) => {
      this.clearBufferedCommand()
      console.log(result.join('\n'))
      this.displayPrompt()
    })
  }
})

brepl.defineCommand('clear', {
  help: 'Switch to default extension context',
  action(){
    this.eval = evalExtensionContext
    this.context.tabId = null
    this.setPrompt(`brepl:${this.context.socketId}> `)
    this.displayPrompt()
  }
})

brepl.defineCommand('socket', {
  help: 'Connect to beval socket <id>',
  action(id) {
    if(!id)
      return this.displayPrompt()

    socket.destroy()
    connectSocket(id)
    this.eval = evalContentScriptContext
    this.context.tabId = null
    this.context.socketId = id
    this.setPrompt(`brepl:${this.context.socketId}> `)
    this.displayPrompt()
  }
})

brepl.defineCommand('sockets', {
  help: 'list all sockets',
  async action(id) {
    this.clearBufferedCommand()
    const files = await readdir(`/tmp/`)
    const sockets = files.filter(file => file.startsWith(`beval.socket.`))
    sockets.forEach(s => console.log(s.split('beval.socket.')[1]))
    this.displayPrompt()
  }
})

connectSocket(0)
